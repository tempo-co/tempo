import {addDays} from '../banking.utils';
import {
	type RecurringCandidate,
	atDate,
	detectRecurringSeries,
	detectUndatedRecurringSeries,
} from './recurring-series-detection';

const TODAY = '2026-10-17';
let nextId = 0;

function payment(date: string, amount: string, overrides: Partial<RecurringCandidate> = {}): RecurringCandidate {
	const cents = BigInt(Math.round(Number(amount) * 100));
	return {
		id: `row-${String(++nextId).padStart(4, '0')}`,
		bankAccountId: 'account-1',
		date,
		merchantKey: 'EXPENSE:example gym',
		currency: 'EUR',
		amountCents: cents,
		baseAmountCents: cents,
		name: 'Example Gym',
		category: 'SUBSCRIPTIONS',
		...overrides,
	};
}

function monthly(day: number, months: string[], amount: string, overrides: Partial<RecurringCandidate> = {}) {
	return months.map((month) => payment(`${month}-${String(day).padStart(2, '0')}`, amount, overrides));
}

const MAY_TO_OCT = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

/** The given day in a month counted from January of `year` (1-based, may overflow into later years). */
function isoMonth(year: number, month: number, day: number): string {
	return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** A day shortly after a payment, before the next one is due. */
function soonAfter(date: string): string {
	return addDays(date, 3);
}

describe('atDate', () => {
	it('renders status and a recent price label from the same stored history on each read date', () => {
		const rows = [...monthly(8, MAY_TO_OCT.slice(0, 5), '10.00'), payment('2026-10-08', '11.50')];
		const [undated] = detectUndatedRecurringSeries(rows);
		expect(atDate(undated, '2026-11-16')).toMatchObject({status: 'ENDED', flags: [], priceChange: null});
		expect(atDate(undated, '2026-10-20')).toMatchObject({
			status: 'ACTIVE',
			flags: [],
			monthlyEquivalent: 1150n,
			priceChange: {amount: '1.50', since: '2026-10-08'},
		});
		expect(undated.priceChange).toEqual({amount: '1.50', since: '2026-10-08'});
	});
});

describe('detectRecurringSeries', () => {
	it('current naming period: prices every interleaved linked name', () => {
		const amounts = ['50.00', '25.00', '100.00', '75.00', '40.00', '60.00'];
		const rows = amounts.map((amount, index) =>
			payment(`2026-${String(index + 7).padStart(2, '0')}-10`, amount, {
				merchantKey: `EXPENSE:example interleaved name ${index % 3}`,
				recurringPayeeKey: 'EXPENSE:automatic-recurring:example-interleaved',
			}),
		);

		expect(detectRecurringSeries(rows, '2027-01-10')).toEqual([
			expect.objectContaining({
				amountKind: 'VARIABLE',
				typicalAmount: '55.00',
				monthlyEquivalent: 5500n,
				nextExpectedDate: '2027-01-10',
				status: 'ACTIVE',
				transactionIds: rows.map(({id}) => id),
				restartTransactionIds: [],
			}),
		]);
	});

	it('current naming period: retains an established variable stream after a long fixed history', () => {
		const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-long-history';
		const previous = Array.from({length: 24}, (_, index) =>
			payment(new Date(Date.UTC(2024, index + 6, 3)).toISOString().slice(0, 10), '16.00', {
				merchantKey: 'EXPENSE:example historical name',
				recurringPayeeKey,
			}),
		);
		const current = ['50.00', '25.00', '100.00', '75.00'].map((amount, index) =>
			payment(`2026-${String(index + 7).padStart(2, '0')}-10`, amount, {
				merchantKey: `EXPENSE:example current name ${index % 2}`,
				recurringPayeeKey,
			}),
		);
		expect(detectRecurringSeries(current, '2026-11-10')).toEqual([
			expect.objectContaining({amountKind: 'VARIABLE', typicalAmount: '62.50', monthlyEquivalent: 6250n}),
		]);
		expect(detectRecurringSeries([...previous, ...current], '2026-11-10')).toEqual([
			expect.objectContaining({
				amountKind: 'VARIABLE',
				typicalAmount: '62.50',
				monthlyEquivalent: 6250n,
				nextExpectedDate: '2026-11-10',
				status: 'ACTIVE',
				transactionIds: [...previous, ...current].map(({id}) => id),
			}),
		]);
		const returned = payment('2026-11-10', '50.00', {
			merchantKey: previous[0].merchantKey,
			recurringPayeeKey,
		});
		expect(detectRecurringSeries([...previous, ...current, returned], '2026-11-10')).toEqual([
			expect.objectContaining({
				amountKind: 'VARIABLE',
				typicalAmount: '50.00',
				monthlyEquivalent: 5000n,
				nextExpectedDate: '2026-12-10',
				status: 'ACTIVE',
				transactionIds: [...previous, ...current, returned].map(({id}) => id),
			}),
		]);
	});

	describe.each([6, 24, 60])('established period after %i historical payments', (oldCount) => {
		it.each(['VARIABLE', 'FIXED'] as const)('continues %s pricing when an older name returns', (amountKind) => {
			const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-returning-label';
			const previous = Array.from({length: oldCount}, (_, index) =>
				payment(new Date(Date.UTC(2026, 6 - oldCount + index, 3)).toISOString().slice(0, 10), '16.00', {
					merchantKey: 'EXPENSE:example returning historical label',
					recurringPayeeKey,
				}),
			);
			const amounts = amountKind === 'VARIABLE' ? ['50.00', '25.00', '100.00', '75.00'] : Array(4).fill('17.00');
			const current = amounts.map((amount, index) =>
				payment(`2026-${String(index + 7).padStart(2, '0')}-10`, amount, {
					merchantKey: `EXPENSE:example returning current label ${index % 2}`,
					recurringPayeeKey,
				}),
			);
			const original = detectRecurringSeries([...previous, ...current], '2026-11-10')[0];
			for (const day of ['10', '15', '16']) {
				const returned = payment(`2026-11-${day}`, amounts[0], {
					merchantKey: previous[0].merchantKey,
					recurringPayeeKey,
				});
				const following = ['2026-12-15', '2027-01-10'].map((date, index) =>
					payment(date, amounts[index + 1], {
						merchantKey: index === 0 ? current[1].merchantKey : previous[0].merchantKey,
						recurringPayeeKey,
					}),
				);
				const rows = [...previous, ...current, returned, ...following];
				const snapshot = structuredClone(rows);
				for (const reverse of [false, true]) {
					for (const count of [0, 1, 2]) {
						const recognized = rows.slice(0, previous.length + current.length + 1 + count);
						const input = reverse ? [...recognized].reverse() : recognized;
						expect(detectRecurringSeries(input, recognized.at(-1)!.date)).toEqual([
							expect.objectContaining({
								key: original.key,
								firstDate: previous[0].date,
								amountKind,
								// Variable: the median of the current period; this month costs what was paid in it.
								typicalAmount: amountKind === 'VARIABLE' ? ['50.00', '50.00', '62.50'][count] : '17.00',
								monthlyEquivalent: amountKind === 'VARIABLE' ? [5000n, 2500n, 10000n][count] : 1700n,
								nextExpectedDate: ['2026-12-10', '2027-01-10', '2027-02-10'][count],
								transactionIds: recognized.map(({id}) => id),
								restartTransactionIds: [
									...original.restartTransactionIds,
									...(day === '16' ? [returned.id] : []),
								],
								status: 'ACTIVE',
							}),
						]);
					}
					const outlier = payment('2027-02-10', '175.00', {
						merchantKey: previous[0].merchantKey,
						recurringPayeeKey,
					});
					const input = [...rows, outlier];
					const [after] = detectRecurringSeries(reverse ? input.reverse() : input, outlier.date);
					expect(after).toMatchObject({
						key: original.key,
						amountKind,
						// A fixed price keeps 17.00 through a one-off; a variable median barely moves, and the month
						// the 175.00 was paid in costs 175.00.
						typicalAmount: amountKind === 'VARIABLE' ? '87.50' : '17.00',
						monthlyEquivalent: amountKind === 'VARIABLE' ? 17500n : 1700n,
					});
					expect(after.transactionIds).toEqual(expect.arrayContaining(rows.map(({id}) => id)));
				}
				expect(rows).toEqual(snapshot);
			}
		});
	});

	it.each(['account-1', 'account-2'])(
		'current naming period: keeps interleaved established obligations separate on %s',
		(bankAccountId) => {
			const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-interleaved-plans';
			const first = monthly(11, ['2030-04', '2030-05', '2030-06', '2030-08'], '27.00', {
				merchantKey: 'EXPENSE:example first plan',
				recurringPayeeKey,
			});
			const second = monthly(11, ['2030-07', '2030-09', '2030-10', '2030-11'], '64.00', {
				merchantKey: 'EXPENSE:example second plan',
				recurringPayeeKey,
				bankAccountId,
			});
			for (const rows of [[...first, ...second], [...second, ...first].reverse()]) {
				expect(detectRecurringSeries(rows, '2030-11-12')).toEqual([
					expect.objectContaining({transactionIds: first.map(({id}) => id), typicalAmount: '27.00'}),
					expect.objectContaining({transactionIds: second.map(({id}) => id), typicalAmount: '64.00'}),
				]);
			}
		},
	);

	describe.each(['account-1', 'account-2'])('complete naming period on %s', (bankAccountId) => {
		describe.each([2, 3])('with %i interleaved names', (nameCount) => {
			it.each([6, 24, 60])('is independent of %i older monthly payments', (oldCount) => {
				const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-complete-cohort';
				const previous = Array.from({length: oldCount}, (_, index) =>
					payment(new Date(Date.UTC(2026, 6 - oldCount + index, 3)).toISOString().slice(0, 10), '16.00', {
						merchantKey: 'EXPENSE:example former cohort',
						recurringPayeeKey,
						currency: 'GBP',
					}),
				);
				const amounts =
					nameCount === 2
						? ['50.00', '25.00', '100.00', '75.00']
						: ['50.00', '25.00', '100.00', '75.00', '40.00', '60.00'];
				const current = amounts.map((amount, index) => {
					const row = payment(`2026-${String(index + 7).padStart(2, '0')}-10`, amount, {
						merchantKey: `EXPENSE:example complete cohort ${index % nameCount}`,
						recurringPayeeKey,
						bankAccountId,
						currency: 'GBP',
					});
					return {...row, baseAmountCents: row.amountCents * 2n};
				});
				const due = nameCount === 2 ? '2026-11-10' : '2027-01-10';
				const expected = nameCount === 2 ? '62.50' : '55.00';
				const baseCost = nameCount === 2 ? 12500n : 11000n;
				const rows = [...previous, ...current];
				const snapshot = structuredClone(rows);
				const baseline = detectRecurringSeries(current, due);
				expect(baseline).toEqual([
					expect.objectContaining({
						amountKind: 'VARIABLE',
						typicalAmount: expected,
						monthlyEquivalent: baseCost,
						nextExpectedDate: due,
						status: 'ACTIVE',
						transactionIds: current.map(({id}) => id),
					}),
				]);
				for (const input of [rows, [...rows].reverse()]) {
					const [linked, ...rest] = detectRecurringSeries(input, due);
					expect(rest).toEqual([]);
					expect(linked).toMatchObject({
						key: detectRecurringSeries(previous, due)[0].key,
						amountKind: baseline[0].amountKind,
						typicalAmount: expected,
						monthlyEquivalent: baseCost,
						nextExpectedDate: due,
						status: 'ACTIVE',
						transactionIds: rows.map(({id}) => id),
						flags: [],
					});
					const next = {...current[0], id: 'example-complete-next', date: due};
					expect(detectRecurringSeries([...input, next], due)[0].restartTransactionIds).toEqual(
						linked.restartTransactionIds,
					);
					for (const missing of [previous[0].id, current[1].id]) {
						expect(
							detectRecurringSeries(
								input.map((row) => (row.id === missing ? {...row, baseAmountCents: null} : row)),
								due,
							)[0],
						).toMatchObject({
							typicalAmount: expected,
							monthlyEquivalent: null,
							transactionIds: linked.transactionIds,
						});
					}
				}
				expect(rows).toEqual(snapshot);
			});
		});
	});

	it('current naming period: retains a unique continuation alongside an independently recognized plan', () => {
		const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-independent-plan';
		const months = Array.from({length: 30}, (_, index) =>
			new Date(Date.UTC(2024, index + 6, 1)).toISOString().slice(0, 7),
		);
		const previous = monthly(3, months.slice(0, 24), '16.00', {
			merchantKey: 'EXPENSE:example previous plan',
			recurringPayeeKey,
		});
		const current = ['50.00', '25.00', '100.00', '75.00', '40.00', '60.00'].map((amount, index) =>
			payment(`${months[index + 24]}-10`, amount, {
				merchantKey: `EXPENSE:example changing plan ${index % 3}`,
				recurringPayeeKey,
				bankAccountId: 'account-2',
			}),
		);
		const parallel = monthly(24, months, '250.00', {
			merchantKey: 'EXPENSE:example independent plan',
			recurringPayeeKey,
			bankAccountId: 'account-3',
		});
		const irregular = ['2026-05-05', '2026-05-07', '2026-06-22', '2026-08-19', '2026-09-27'].map((date) =>
			payment(date, '11.00', {
				merchantKey: 'EXPENSE:example irregular plan',
				recurringPayeeKey,
				bankAccountId: 'account-4',
			}),
		);
		for (const input of [
			[...previous, ...current, ...parallel, ...irregular],
			[...irregular, ...parallel, ...current, ...previous].reverse(),
		]) {
			const result = detectRecurringSeries(input, '2027-01-10');
			expect(result).toHaveLength(2);
			expect(result).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						amountKind: 'VARIABLE',
						typicalAmount: '55.00',
						monthlyEquivalent: 5500n,
						transactionIds: [...previous, ...current].map(({id}) => id),
					}),
					expect.objectContaining({
						amountKind: 'FIXED',
						typicalAmount: '250.00',
						monthlyEquivalent: 25000n,
						transactionIds: parallel.map(({id}) => id),
					}),
				]),
			);
		}
	});

	it.each([
		['18.00', '42.00'],
		['42.00', '18.00'],
	])(
		'current naming period: keeps an established %s to %s price through an isolated outlier',
		(oldPrice, newPrice) => {
			const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-isolated-cohort';
			const previous = monthly(11, ['2026-01', '2026-02', '2026-03', '2026-04'], oldPrice, {
				merchantKey: 'EXPENSE:example previous price',
				recurringPayeeKey,
			});
			const current = monthly(11, ['2026-05', '2026-06', '2026-07'], newPrice, {
				merchantKey: 'EXPENSE:example current price',
				recurringPayeeKey,
			});
			const outlier = payment('2026-08-11', '175.00', {merchantKey: current[0].merchantKey, recurringPayeeKey});
			const rows = [...previous, ...current, outlier];
			for (const input of [rows, [...rows].reverse()]) {
				expect(detectRecurringSeries(input, '2026-08-12')).toEqual([
					expect.objectContaining({
						amountKind: 'FIXED',
						typicalAmount: newPrice,
						latestAmount: '175.00',
						monthlyEquivalent: current[0].amountCents,
						nextExpectedDate: '2026-09-11',
						flags: [],
						transactionIds: rows.map(({id}) => id),
					}),
				]);
			}
		},
	);

	it('current naming period: never pools unrecognized names across bank accounts', () => {
		const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-local-evidence';
		const previous = Array.from({length: 24}, (_, index) =>
			payment(new Date(Date.UTC(2024, index + 6, 3)).toISOString().slice(0, 10), '16.00', {
				merchantKey: 'EXPENSE:example local previous',
				recurringPayeeKey,
			}),
		);
		const current = ['50.00', '25.00', '100.00', '75.00'].map((amount, index) =>
			payment(`2026-${String(index + 7).padStart(2, '0')}-10`, amount, {
				merchantKey: `EXPENSE:example local current ${index % 2}`,
				recurringPayeeKey,
				bankAccountId: `account-${(index % 2) + 1}`,
			}),
		);
		const baseline = detectRecurringSeries(previous, '2026-11-10');
		for (const rows of [[...previous, ...current], [...current, ...previous].reverse()]) {
			expect(detectRecurringSeries(rows, '2026-11-10')).toEqual(baseline);
		}
	});

	it('linked names: joins name variants without rewriting candidates', () => {
		const rows = [
			...monthly(3, MAY_TO_OCT.slice(0, 3), '40.00', {merchantKey: 'EXPENSE:example cover old'}),
			...monthly(3, MAY_TO_OCT.slice(3), '68.00', {merchantKey: 'EXPENSE:example cover new'}),
		].map((row) => ({...row, recurringPayeeKey: 'EXPENSE:automatic-recurring:example-cover'}));
		const before = structuredClone(rows);

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({
				transactionIds: rows.map(({id}) => id),
				typicalAmount: '68.00',
				monthlyEquivalent: 6800n,
				status: 'ACTIVE',
			}),
		]);
		expect(rows).toEqual(before);
	});

	it.each(['merchant', 'account'])(
		'recurring continuity: keeps the latest established %s period current',
		(change) => {
			const previous = monthly(3, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'], '16.00');
			const current = ['2026-07-15', '2026-08-11', '2026-09-09', '2026-10-07'].map((date) =>
				payment(date, '17.00', {
					...(change === 'merchant'
						? {merchantKey: 'EXPENSE:example current membership'}
						: {bankAccountId: 'account-2'}),
				}),
			);
			const rows = [...previous, ...current].map((row) => ({
				...row,
				recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
			}));

			expect(detectRecurringSeries(rows, '2026-11-13')).toEqual([
				expect.objectContaining({
					transactionIds: rows.map(({id}) => id),
					typicalAmount: '17.00',
					latestAmount: '17.00',
					monthlyEquivalent: 1700n,
					nextExpectedDate: '2026-11-10',
					status: 'ACTIVE',
					flags: ['LATE'],
					priceChange: null,
				}),
			]);
		},
	);

	describe.each(['forward', 'reverse'] as const)('current-stream input order: %s', (order) => {
		it.each([
			[
				'cross-account variable bills',
				['50.00', '25.00', '100.00', '75.00'],
				false,
				'account-2',
				'VARIABLE',
				'62.50',
				6250n,
			],
			[
				'cross-account alternating names',
				['17.00', '17.00', '17.00', '17.00'],
				true,
				'account-2',
				'FIXED',
				'17.00',
				1700n,
			],
			[
				'same-account variable alternating names',
				['50.00', '25.00', '100.00', '75.00'],
				true,
				'account-1',
				'VARIABLE',
				'62.50',
				6250n,
			],
			[
				'same-account fixed alternating names',
				['17.00', '17.00', '17.00', '17.00'],
				true,
				'account-1',
				'FIXED',
				'17.00',
				1700n,
			],
		] as const)(
			'recurring continuity: preserves the recognized current account stream for %s',
			(_label, amounts, alternateNames, bankAccountId, amountKind, typicalAmount, monthlyEquivalent) => {
				const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-current-stream';
				const previous = monthly(
					3,
					['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
					'16.00',
					{
						recurringPayeeKey,
					},
				);
				const current = ['2026-07', '2026-08', '2026-09', '2026-10'].map((month, index) =>
					payment(`${month}-10`, amounts[index], {
						bankAccountId,
						merchantKey: `EXPENSE:example current bill ${alternateNames ? index % 2 : 0}`,
						recurringPayeeKey,
					}),
				);
				const rows = [...previous, ...current];
				const snapshot = structuredClone(rows);
				const [baseline] = detectRecurringSeries(current, '2026-11-10');
				expect(baseline).toMatchObject({
					cadence: 'MONTHLY',
					amountKind,
					typicalAmount,
					monthlyEquivalent,
					nextExpectedDate: '2026-11-10',
					status: 'ACTIVE',
				});
				const originalKey = detectRecurringSeries(previous, TODAY)[0].key;
				const input = order === 'reverse' ? [...rows].reverse() : rows;
				const on = (asOf: string) => detectRecurringSeries(input, asOf);
				expect(on('2026-11-10')).toEqual([
					expect.objectContaining({
						key: originalKey,
						cadence: baseline.cadence,
						amountKind: baseline.amountKind,
						typicalAmount: baseline.typicalAmount,
						latestAmount: baseline.latestAmount,
						monthlyEquivalent: baseline.monthlyEquivalent,
						transactionIds: rows.map(({id}) => id),
						firstDate: previous[0].date,
						lastDate: current[current.length - 1].date,
						nextExpectedDate: baseline.nextExpectedDate,
						status: baseline.status,
					}),
				]);
				for (const asOf of ['2026-11-11', '2026-11-15']) {
					expect(on(asOf)[0]).toMatchObject({status: 'ACTIVE', flags: expect.arrayContaining(['LATE'])});
				}
				expect(on('2026-11-16')[0]).toMatchObject({status: 'ENDED', flags: []});
				expect(detectRecurringSeries([...rows].reverse(), '2026-11-10')).toEqual(on('2026-11-10'));
				const next = {...current[0], id: 'example-next-payment', date: baseline.nextExpectedDate};
				expect(detectRecurringSeries([...input, next], '2026-11-11')[0].restartTransactionIds).toEqual(
					on('2026-11-10')[0].restartTransactionIds,
				);
				expect(rows).toEqual(snapshot);
				expect(
					detectRecurringSeries(
						input.map((row) => (row.id === previous[0].id ? {...row, baseAmountCents: null} : row)),
						TODAY,
					)[0],
				).toMatchObject({
					typicalAmount,
					monthlyEquivalent: null,
				});
			},
		);
	});

	it.each(['forward', 'reverse'] as const)(
		'recurring continuity: preserves a qualifying current raw-name history across recognized price parts (%s)',
		(order) => {
			const recurringPayeeKey = 'EXPENSE:automatic-recurring:example-recognized-prices';
			const previous = monthly(3, ['2036-01', '2036-02', '2036-03', '2036-04', '2036-05', '2036-06'], '20.00', {
				merchantKey: 'EXPENSE:example legacy prices',
				recurringPayeeKey,
			});
			const current = [
				'2036-07-24',
				'2036-08-24',
				'2036-09-24',
				'2036-10-24',
				'2036-11-24',
				'2036-12-19',
				'2037-01-17',
				'2037-02-15',
				'2037-03-13',
			].map((date, index) =>
				payment(date, index < 5 ? '70.00' : '21.00', {
					merchantKey: 'EXPENSE:example current prices',
					recurringPayeeKey,
				}),
			);
			const noise = ['2036-02-20', '2036-08-24'].map((date) =>
				payment(date, '0.10', {merchantKey: current[0].merchantKey, recurringPayeeKey}),
			);
			const recognized = [...previous, ...current];
			const rows = [...recognized, ...noise];
			const snapshot = structuredClone(rows);
			const input = order === 'reverse' ? [...rows].reverse() : rows;
			const asOf = '2037-04-24';
			const [baseline] = detectRecurringSeries(
				current.map((row) => ({...row, recurringPayeeKey: undefined})),
				asOf,
			);
			expect(baseline).toMatchObject({
				amountKind: 'FIXED',
				typicalAmount: '21.00',
				monthlyEquivalent: 2100n,
				nextExpectedDate: '2037-04-24',
				transactionIds: current.map(({id}) => id),
			});
			// The raw partition recognizes two price parts; reconciliation must exclude the tiny extra charges.
			expect(
				detectRecurringSeries(
					rows.map((row) => ({...row, merchantKey: recurringPayeeKey, recurringPayeeKey: undefined})),
					asOf,
				).map(({transactionIds}) => transactionIds),
			).toEqual([[...previous, ...current.slice(5)].map(({id}) => id), current.slice(0, 5).map(({id}) => id)]);
			const [linked, ...rest] = detectRecurringSeries(input, asOf);
			expect(rest).toEqual([]);
			expect(linked).toMatchObject({
				amountKind: baseline.amountKind,
				typicalAmount: baseline.typicalAmount,
				latestAmount: baseline.latestAmount,
				monthlyEquivalent: baseline.monthlyEquivalent,
				nextExpectedDate: baseline.nextExpectedDate,
				status: baseline.status,
				transactionIds: recognized.map(({id}) => id),
			});
			const next = {
				...current[current.length - 1],
				id: 'example-recognized-next',
				date: baseline.nextExpectedDate,
			};
			expect(detectRecurringSeries([...input, next], next.date)[0].restartTransactionIds).toEqual(
				linked.restartTransactionIds,
			);
			expect(rows).toEqual(snapshot);
		},
	);

	it('recurring continuity: a payment on the predicted current date is not another restart', () => {
		const previous = monthly(3, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'], '16.00');
		const current = ['2026-07-15', '2026-08-11', '2026-09-09', '2026-10-07'].map((date) =>
			payment(date, '17.00', {bankAccountId: 'account-2'}),
		);
		const rows = [...previous, ...current].map((row) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		}));
		const [before] = detectRecurringSeries(rows, TODAY);
		expect(before.nextExpectedDate).toBe('2026-11-10');
		const next = payment('2026-11-10', '17.00', {
			bankAccountId: 'account-2',
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		});

		expect(detectRecurringSeries([...rows, next], '2026-11-11')).toEqual([
			expect.objectContaining({
				key: before.key,
				transactionIds: [...rows, next].map(({id}) => id),
				restartTransactionIds: before.restartTransactionIds,
				monthlyEquivalent: 1700n,
			}),
		]);
	});

	it('recurring continuity: retains the current account stream anchor when an account is reused', () => {
		const first = monthly(3, ['2026-01', '2026-02', '2026-03'], '24.00');
		const middle = monthly(15, ['2026-04', '2026-05', '2026-06'], '24.00', {bankAccountId: 'account-2'});
		const returned = ['2026-07-15', '2026-08-11', '2026-09-09', '2026-10-07'].map((date) => payment(date, '24.00'));
		const rows = [...first, ...middle, ...returned].map((row) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		}));

		expect(detectRecurringSeries([...first, ...returned], '2026-11-10')[0]).toMatchObject({
			nextExpectedDate: '2026-11-07',
			status: 'ACTIVE',
			flags: ['LATE'],
		});
		expect(detectRecurringSeries(rows, '2026-11-10')).toEqual([
			expect.objectContaining({
				transactionIds: rows.map(({id}) => id),
				nextExpectedDate: '2026-11-07',
				status: 'ACTIVE',
				flags: ['LATE'],
			}),
		]);
	});

	it('recurring continuity: joins one subscription moving accounts', () => {
		const rows = [
			...monthly(3, MAY_TO_OCT.slice(0, 3), '24.00', {bankAccountId: 'account-1'}),
			...monthly(3, MAY_TO_OCT.slice(3), '24.00', {bankAccountId: 'account-2'}),
		].map((row) => ({...row, recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership'}));

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({
				transactionIds: rows.map(({id}) => id),
				monthlyEquivalent: 2400n,
				nextExpectedDate: '2026-11-03',
				status: 'ACTIVE',
			}),
		]);
	});

	it('recurring continuity: does not hide a short simultaneous plan inside a long history', () => {
		const months = Array.from(
			{length: 60},
			(_, index) => `${2020 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
		);
		const older = monthly(3, months, '24.00', {bankAccountId: 'account-1'});
		const parallel = monthly(11, months.slice(-3), '24.00', {bankAccountId: 'account-2'});
		const rows = [...older, ...parallel].map((row) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		}));

		const result = detectRecurringSeries(rows, TODAY);
		expect(result).toHaveLength(2);
		expect(result.map(({transactionIds}) => transactionIds)).toEqual([
			older.map(({id}) => id),
			parallel.map(({id}) => id),
		]);
	});

	it('recurring continuity: links a continuing history alongside an independent plan', () => {
		const first = monthly(3, MAY_TO_OCT.slice(0, 3), '24.00', {bankAccountId: 'account-1'});
		const second = monthly(3, MAY_TO_OCT.slice(3), '24.00', {bankAccountId: 'account-2'});
		const parallel = monthly(15, MAY_TO_OCT, '58.00', {bankAccountId: 'account-3'});
		const rows = [...first, ...second, ...parallel].map((row) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		}));

		expect(detectRecurringSeries(rows, TODAY).map(({transactionIds}) => transactionIds)).toEqual([
			[...first, ...second].map(({id}) => id),
			parallel.map(({id}) => id),
		]);
	});

	it('linked names: preserve the yearly person-transfer exclusion', () => {
		const rows = ['2023-03-10', '2024-03-10', '2025-03-10'].map((date) => ({
			...payment(date, '120.00', {merchantKey: 'EXPENSE:alex example', personTransfer: true}),
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-person',
		}));

		expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
	});

	it('recurring continuity: handles an account that is left and later used again', () => {
		const firstAccount = monthly(3, ['2026-01', '2026-02', '2026-03', '2026-07', '2026-08', '2026-09'], '24.00');
		const middle = monthly(3, ['2026-04', '2026-05', '2026-06'], '24.00', {bankAccountId: 'account-2'});
		const rows = [...firstAccount, ...middle].map((row) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		}));
		const expectedIds = [...rows].sort((a, b) => a.date.localeCompare(b.date)).map(({id}) => id);
		const result = detectRecurringSeries(rows, '2026-09-04');

		expect(result).toEqual([
			expect.objectContaining({transactionIds: expectedIds, monthlyEquivalent: 2400n, status: 'ACTIVE'}),
		]);
		expect(detectRecurringSeries([...rows].reverse(), '2026-09-04')).toEqual(result);
	});

	it('recurring continuity: keeps a genuine stopped interval and the later restart', () => {
		const old = monthly(3, ['2026-01', '2026-02', '2026-03'], '24.00');
		const restarted = monthly(3, ['2026-08', '2026-09', '2026-10'], '24.00', {bankAccountId: 'account-2'});
		const map = (row: RecurringCandidate) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		});

		expect(detectRecurringSeries(old.map(map), '2026-04-08')[0]).toMatchObject({status: 'ACTIVE', flags: ['LATE']});
		expect(detectRecurringSeries(old.map(map), '2026-04-09')[0]).toMatchObject({status: 'ENDED'});
		expect(detectRecurringSeries([...old, ...restarted].map(map), TODAY)).toEqual([
			expect.objectContaining({
				transactionIds: [...old, ...restarted].map(({id}) => id),
				restartTransactionIds: [restarted[0].id],
				status: 'ACTIVE',
			}),
		]);
	});

	it('recurring continuity: does not pool irregular activity from another account', () => {
		const bill = MAY_TO_OCT.map((month, index) =>
			payment(`${month}-03`, ['10', '30', '60', '90', '20', '80'][index]),
		);
		const topups = ['2026-05-05', '2026-05-07', '2026-06-22', '2026-08-19', '2026-09-27'].map((date) =>
			payment(date, '11.00', {bankAccountId: 'account-2'}),
		);
		const map = (row: RecurringCandidate) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		});
		const baseline = detectRecurringSeries(bill.map(map), TODAY);

		expect(baseline).toHaveLength(1);
		expect(baseline[0].amountKind).toBe('VARIABLE');
		expect(detectRecurringSeries([...bill, ...topups].map(map), TODAY)).toEqual(baseline);
	});

	it('recurring continuity: does not choose between two plausible predecessor obligations', () => {
		const first = monthly(3, MAY_TO_OCT.slice(0, 3), '24.00');
		const other = monthly(3, MAY_TO_OCT.slice(0, 3), '58.00', {bankAccountId: 'account-2'});
		const later = monthly(3, MAY_TO_OCT.slice(3), '90.00', {bankAccountId: 'account-3'});
		const rows = [...first, ...other, ...later].map((row) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		}));
		const memberships = (input: typeof rows) =>
			detectRecurringSeries(input, TODAY)
				.map(({transactionIds}) => transactionIds.join(','))
				.sort();

		expect(memberships(rows)).toEqual([first, other, later].map((part) => part.map(({id}) => id).join(',')).sort());
		expect(memberships([...rows].reverse())).toEqual(memberships(rows));
	});

	it.each(['24.00', '58.00'])('recurring continuity: keeps skipped-cycle parallel plans at %s separate', (amount) => {
		const months = [
			'2025-01',
			'2025-02',
			'2025-03',
			'2025-04',
			'2025-05',
			'2025-06',
			'2025-07',
			'2025-08',
			'2025-09',
		];
		const first = monthly(3, months, '24.00');
		const parallel = monthly(
			17,
			months.filter((_month, index) => [0, 1, 2, 4, 5, 8].includes(index)),
			amount,
			{bankAccountId: 'account-2'},
		);
		const rows = [...first, ...parallel].map((row) => ({
			...row,
			recurringPayeeKey: 'EXPENSE:automatic-recurring:example-membership',
		}));

		expect(detectRecurringSeries(rows, TODAY).map(({transactionIds}) => transactionIds)).toEqual([
			first.map(({id}) => id),
			parallel.map(({id}) => id),
		]);
	});

	it('detects a fixed monthly payment with its next date and monthly cost', () => {
		const [series, ...rest] = detectRecurringSeries(monthly(3, MAY_TO_OCT, '29.99'), TODAY);

		expect(rest).toHaveLength(0);
		expect(series).toMatchObject({
			cadence: 'MONTHLY',
			amountKind: 'FIXED',
			direction: 'EXPENSE',
			typicalAmount: '29.99',
			monthlyEquivalent: 2999n,
			firstDate: '2026-05-03',
			lastDate: '2026-10-03',
			nextExpectedDate: '2026-11-03',
			status: 'ACTIVE',
			flags: [],
		});
		expect(series.transactionIds).toHaveLength(6);
	});

	it('tolerates drifting days and one skipped month', () => {
		const rows = [
			payment('2026-04-01', '12.00'),
			payment('2026-05-03', '12.00'),
			payment('2026-05-30', '12.00'),
			// July skipped.
			payment('2026-08-01', '12.00'),
			payment('2026-09-02', '12.00'),
			payment('2026-10-01', '12.00'),
		];

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({cadence: 'MONTHLY', transactionIds: rows.map((row) => row.id)}),
		]);
	});

	it.each([
		['three-payment ambiguous', ['2033-01-19', '2033-02-16', '2033-03-16'], 'MONTHLY'],
		['short four-weekly', ['2033-01-19', '2033-02-16', '2033-03-16', '2033-04-13'], 'FOUR_WEEKLY'],
		[
			'four-weekly with bank-date drift',
			Array.from({length: 8}, (_, index) => addDays('2033-01-03', 28 * index + (index % 2))),
			'FOUR_WEEKLY',
		],
		[
			'four-weekly with three-day bank-date drift',
			Array.from({length: 12}, (_, index) => addDays('2033-01-03', 28 * index + 3 * (index % 2))),
			'FOUR_WEEKLY',
		],
		[
			'four-weekly with skipped cycles',
			[0, 1, 3, 4, 5, 7].map((cycle) => addDays('2033-01-03', 28 * cycle)),
			'FOUR_WEEKLY',
		],
		[
			'calendar-month with an occasional late cycle',
			['2033-01-04', '2033-02-01', '2033-03-01', '2033-03-29', '2033-05-05'],
			'MONTHLY',
		],
		[
			'calendar-month with overlapping gap tolerances',
			['2033-01-18', '2033-02-15', '2033-03-15', '2033-04-15', '2033-05-13', '2033-06-13'],
			'MONTHLY',
		],
		[
			'calendar-month with bank-date drift',
			[
				'2033-01-19',
				'2033-02-16',
				'2033-03-16',
				'2033-04-19',
				'2033-05-17',
				'2033-06-14',
				'2033-07-19',
				'2033-08-16',
				'2033-09-13',
				'2033-10-18',
				'2033-11-15',
				'2033-12-13',
			],
			'MONTHLY',
		],
	] as const)('recognizes the complete %s rhythm', (_label, dates, cadence) => {
		const rows = dates.map((date) => payment(date, '24.00'));
		expect(detectRecurringSeries(rows, dates.at(-1)!)).toEqual([
			expect.objectContaining({
				cadence,
				transactionIds: rows.map(({id}) => id),
				monthlyEquivalent: cadence === 'FOUR_WEEKLY' ? 2600n : 2400n,
				...(cadence === 'FOUR_WEEKLY' ? {nextExpectedDate: addDays(dates.at(-1)!, 28)} : {}),
			}),
		]);
	});

	it('recognizes a variable monthly stream with a short fixed-price period and extra purchases', () => {
		const dates = ['2033-01-18', '2033-02-15', '2033-03-15', '2033-04-12', '2033-05-17', '2033-06-14'];
		const recurring = dates.map((date, index) =>
			payment(date, index < 4 ? '12.00' : index === 4 ? '24.00' : '5.00'),
		);
		const extras = ['2033-01-21', '2033-03-18', '2033-05-20'].map((date) => payment(date, '39.00'));
		expect(detectRecurringSeries([...recurring, ...extras], dates.at(-1)!)).toEqual([
			expect.objectContaining({cadence: 'MONTHLY', transactionIds: recurring.map(({id}) => id)}),
		]);
	});

	it.each([-56, -58, -86])('recognizes a four-weekly price after an earlier one-off charge at day %i', (offset) => {
		const recurring = Array.from({length: 4}, (_, index) => payment(addDays('2033-01-03', 28 * index), '24.00'));
		const oneOff = payment(addDays(recurring[0].date, offset), '4.50');
		const newPrice = Array.from({length: 4}, (_, index) =>
			payment(addDays(recurring.at(-1)!.date, 28 * (index + 1)), '30.00'),
		);
		const extra = payment(addDays(recurring[0].date, 7), '39.00');
		const histories = Array.from({length: 5}, (_, count) => [...recurring, ...newPrice.slice(0, count)]);
		const snapshots = (extras: RecurringCandidate[]) =>
			histories.map((history) => detectRecurringSeries([oneOff, ...history, ...extras], history.at(-1)!.date));
		const expected = histories.map((history, count) => [
			expect.objectContaining({
				cadence: 'FOUR_WEEKLY',
				amountKind: 'FIXED',
				typicalAmount: count ? '30.00' : '24.00',
				monthlyEquivalent: count ? 3250n : 2600n,
				firstDate: recurring[0].date,
				lastDate: history.at(-1)!.date,
				nextExpectedDate: addDays(history.at(-1)!.date, 28),
				latestAmount: count ? '30.00' : '24.00',
				status: 'ACTIVE',
				flags: [],
				restartTransactionIds: [],
				transactionIds: history.map(({id}) => id),
			}),
		]);
		expect({alone: snapshots([]), interleaved: snapshots([extra])}).toEqual({
			alone: expected,
			interleaved: expected,
		});
	});

	it.each([
		{
			label: 'four-weekly variable',
			dates: Array.from({length: 10}, (_, index) => addDays('2033-01-03', 28 * index)),
			amounts: ['24.00', '49.00', '18.00', '65.00', '31.00', '77.00', ...Array<string>(4).fill('30.00')],
			cadence: 'FOUR_WEEKLY',
			amountKind: 'VARIABLE',
			typicalAmount: '30.00',
			monthlyEquivalent: 3250n,
			restartIndices: [],
		},
		...[0, 1].flatMap((joiningOffset) =>
			[false, true].map((variable) => ({
				label: `monthly ${variable ? 'variable' : 'fixed'} joining at offset ${joiningOffset}`,
				dates: [
					'2033-01-03',
					'2033-02-03',
					'2033-03-03',
					...Array.from({length: 4}, (_, index) => addDays('2033-04-03', joiningOffset + 28 * index)),
				],
				amounts: [
					...(variable ? ['24.00', '4.50', '30.00'] : Array<string>(3).fill('4.50')),
					...Array<string>(4).fill('24.00'),
				],
				cadence: 'MONTHLY',
				amountKind: variable ? 'VARIABLE' : 'FIXED',
				typicalAmount: '24.00',
				monthlyEquivalent: 2400n,
				restartIndices: [],
			})),
		),
		{
			label: 'monthly variable completed before the joining payment',
			dates: ['2033-01-03', '2033-02-03', '2033-03-03', '2033-04-09', '2033-05-07', '2033-06-04', '2033-07-02'],
			amounts: ['24.00', '4.50', '30.00', ...Array<string>(4).fill('24.00')],
			cadence: 'MONTHLY',
			amountKind: 'VARIABLE',
			typicalAmount: '24.00',
			monthlyEquivalent: 2400n,
			nextExpectedDate: '2033-08-03',
			restartIndices: [3],
		},
		...[-1, 0].flatMap((joiningOffset) =>
			[false, true].map((samePrice) => ({
				label: `monthly ${samePrice ? 'fixed' : 'variable'} with a shared joining payment at offset ${joiningOffset}`,
				dates: [
					'2033-01-03',
					'2033-02-03',
					...Array.from({length: 5}, (_, index) => addDays('2033-03-03', joiningOffset + 28 * index)),
				],
				amounts: ['24.00', samePrice ? '24.00' : '4.50', ...Array<string>(5).fill('24.00')],
				cadence: 'FOUR_WEEKLY',
				amountKind: samePrice ? 'FIXED' : 'VARIABLE',
				latestAmount: '24.00',
				typicalAmount: '24.00',
				monthlyEquivalent: 2600n,
				nextExpectedDate: addDays('2033-07-21', joiningOffset),
				restartIndices: [],
			})),
		),
	])(
		'recognizes a supported $label history before a settled price',
		({label: _label, dates, amounts, restartIndices, ...expected}) => {
			const rows = dates.map((date, index) => payment(date, amounts[index]));
			const supported = rows.slice(0, 3);
			expect(detectRecurringSeries(supported, supported.at(-1)!.date)).toEqual([
				expect.objectContaining({
					cadence: 'MONTHLY',
					amountKind: expected.amountKind,
					transactionIds: supported.map(({id}) => id),
				}),
			]);
			expect(detectRecurringSeries(rows, rows.at(-1)!.date)).toEqual([
				expect.objectContaining({
					...expected,
					latestAmount: amounts.at(-1),
					status: 'ACTIVE',
					flags: [],
					restartTransactionIds: restartIndices.map((index) => rows[index].id),
					firstDate: rows[0].date,
					lastDate: rows.at(-1)!.date,
					transactionIds: rows.map(({id}) => id),
				}),
			]);
		},
	);

	it('needs three monthly payments', () => {
		expect(detectRecurringSeries(monthly(3, ['2026-08', '2026-09'], '9.99'), TODAY)).toEqual([]);
	});

	it('detects weekly, four-weekly and quarterly payments with their monthly equivalents', () => {
		const weekly = ['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17'].map((date) =>
			payment(date, '6.00', {merchantKey: 'EXPENSE:example lessons'}),
		);
		const quarterly = ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map((date) =>
			payment(date, '90.00', {merchantKey: 'EXPENSE:example water'}),
		);

		const fourWeekly = Array.from({length: 6}, (_, index) =>
			payment(addDays('2026-05-03', 28 * index), '12.00', {merchantKey: 'EXPENSE:example four-weekly lessons'}),
		);
		const series = detectRecurringSeries([...weekly, ...fourWeekly, ...quarterly], TODAY);

		expect(series).toHaveLength(3);
		const fourWeeklySeries = series.find(({cadence}) => cadence === 'FOUR_WEEKLY')!;
		const due = fourWeeklySeries.nextExpectedDate;
		expect(atDate(fourWeeklySeries, due)).toMatchObject({status: 'ACTIVE', flags: [], monthlyEquivalent: 1300n});
		expect(atDate(fourWeeklySeries, addDays(due, 5))).toMatchObject({status: 'ACTIVE', flags: ['LATE']});
		expect(atDate(fourWeeklySeries, addDays(due, 6))).toMatchObject({status: 'ENDED', flags: []});
		const onTime = payment(due, '12.00', {merchantKey: fourWeekly[0].merchantKey});
		expect(detectRecurringSeries([...fourWeekly, onTime], due)).toEqual([
			expect.objectContaining({
				cadence: 'FOUR_WEEKLY',
				nextExpectedDate: addDays(due, 28),
				restartTransactionIds: [],
				monthlyEquivalent: 1300n,
				status: 'ACTIVE',
			}),
		]);
		expect(series).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cadence: 'FOUR_WEEKLY',
					amountKind: 'FIXED',
					typicalAmount: '12.00',
					monthlyEquivalent: 1300n,
					nextExpectedDate: addDays(fourWeekly.at(-1)!.date, 28),
					transactionIds: fourWeekly.map(({id}) => id),
				}),
				expect.objectContaining({cadence: 'WEEKLY', monthlyEquivalent: 2600n, nextExpectedDate: '2026-10-24'}),
				expect.objectContaining({
					cadence: 'QUARTERLY',
					monthlyEquivalent: 3000n,
					nextExpectedDate: '2027-01-15',
				}),
			]),
		);
	});

	it('suggests a yearly series from two payments', () => {
		const rows = [payment('2025-03-10', '120.00'), payment('2026-03-12', '120.00')];

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({cadence: 'YEARLY', monthlyEquivalent: 1000n, nextExpectedDate: '2027-03-11'}),
		]);
	});

	it.each([
		['food', ['FOOD_AND_DRINK', 'FOOD_AND_DRINK']],
		['shopping', ['SHOPPING', 'SHOPPING']],
		['uncategorized', [null, null]],
		['mixed', ['SUBSCRIPTIONS', 'INSURANCE']],
		['insurance', ['INSURANCE', 'INSURANCE']],
	] as const)('needs more than two annual payments for %s', (_label, categories) => {
		for (const amounts of [
			['120.00', '120.00'],
			['120.00', '240.00'],
		]) {
			const rows = ['2025-03-10', '2026-03-12'].map((date, index) =>
				payment(date, amounts[index], {category: categories[index]}),
			);

			expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
		}
	});

	it.each([
		[['120.00', '120.00', '120.00'], 'INSURANCE', 'FIXED', '120.00', 1000n],
		[['120.00', '240.00', '180.00'], 'INSURANCE', 'VARIABLE', '180.00', 1500n],
		[['120.00', '240.00'], 'SUBSCRIPTIONS', 'VARIABLE', '180.00', 1500n],
	] as const)('accepts eligible annual amounts %j in %s', (amounts, category, amountKind, typicalAmount, cost) => {
		const dates = amounts.length === 2 ? ['2025-03-10', '2026-03-12'] : ['2024-03-10', '2025-03-11', '2026-03-12'];
		const rows = dates.map((date, index) => payment(date, amounts[index], {category}));

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({
				cadence: 'YEARLY',
				amountKind,
				typicalAmount,
				monthlyEquivalent: cost,
				transactionIds: rows.map(({id}) => id),
			}),
		]);
	});

	it.each([2, 3])('excludes people and busy payees from annual detection with %i occurrences', (count) => {
		const dates = ['2024-03-10', '2025-03-11', '2026-03-12'].slice(-count);
		const people = dates.map((date) =>
			payment(date, '120.00', {merchantKey: 'EXPENSE:alex example', personTransfer: true}),
		);
		const categorized = dates.map((date) => payment(date, '120.00', {category: 'TRANSFER_OUT'}));
		const busy = [
			...dates.map((date) => payment(date, '120.00')),
			...['2025-05-02', '2025-07-19', '2025-09-08', '2026-01-23'].map((date) => payment(date, '18.40')),
		];

		for (const rows of [people, categorized, busy]) expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
	});

	it('does not suggest a yearly series at a payee paid often in between', () => {
		const rows = [
			payment('2025-03-10', '120.00'),
			...['2025-05-02', '2025-07-19', '2025-09-08', '2026-01-23'].map((date) => payment(date, '18.40')),
			payment('2026-03-12', '120.00'),
		];

		expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
	});

	it('keeps tracking a variable bill after an early run of a stable amount ends', () => {
		const rows = [
			...monthly(3, MAY_TO_OCT.slice(0, 3), '100.00', {merchantKey: 'EXPENSE:example energy'}),
			payment('2026-08-03', '200.00', {merchantKey: 'EXPENSE:example energy'}),
			payment('2026-09-03', '50.00', {merchantKey: 'EXPENSE:example energy'}),
			payment('2026-10-03', '300.00', {merchantKey: 'EXPENSE:example energy'}),
		];

		const result = detectRecurringSeries(rows, '2026-10-20');
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({amountKind: 'VARIABLE', status: 'ACTIVE'});
		expect(result[0].transactionIds).toHaveLength(6);
	});

	it('does not let one isolated payment hide a later run of genuinely variable bills', () => {
		const rows = [
			...monthly(9, ['2032-01', '2032-02', '2032-03'], '16.00'),
			...monthly(9, ['2032-04', '2032-05', '2032-06'], '38.00'),
			payment('2032-07-09', '72.00'),
			payment('2032-08-09', '105.00'),
			payment('2032-09-09', '150.00'),
		];
		expect(detectRecurringSeries(rows, '2032-09-12')).toEqual([
			expect.objectContaining({amountKind: 'VARIABLE', transactionIds: rows.map(({id}) => id)}),
		]);
	});

	it('assigns an isolated payment by its empty cycle instead of a sibling with the same amount', () => {
		const older = monthly(11, ['2039-01', '2039-02', '2039-03'], '34.00');
		const newer = monthly(11, ['2039-04', '2039-05', '2039-06', '2039-07'], '81.00');
		const concurrent = monthly(
			24,
			['2039-01', '2039-02', '2039-03', '2039-04', '2039-05', '2039-06', '2039-07', '2039-08'],
			'320.00',
		);
		const isolated = payment('2039-08-11', '320.00');
		expect(detectRecurringSeries([...older, ...newer, ...concurrent, isolated], '2039-08-25')).toEqual([
			expect.objectContaining({
				latestAmount: '320.00',
				transactionIds: [...older, ...newer, isolated].map(({id}) => id),
			}),
			expect.objectContaining({transactionIds: concurrent.map(({id}) => id)}),
		]);
	});

	it.each([1, 5, 11, 16, 20, 24, 28])('does not merge staggered variable plans billed on day %i', (day) => {
		const ongoing = Array.from({length: 29}, (_, index) => {
			const month = new Date(Date.UTC(2042, index, 11)).toISOString().slice(0, 10);
			return payment(month, index % 2 ? '36.00' : '15.00');
		});
		const other = Array.from({length: 4}, (_, index) =>
			payment(
				`2042-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
				index % 2 ? '600.00' : '300.00',
			),
		);
		const ongoingIds = new Set(ongoing.map(({id}) => id));
		const otherIds = new Set(other.map(({id}) => id));
		const result = detectRecurringSeries([...ongoing, ...other], '2044-05-12');
		expect(
			result.every(
				({transactionIds}) =>
					!(transactionIds.some((id) => ongoingIds.has(id)) && transactionIds.some((id) => otherIds.has(id))),
			),
		).toBe(true);
	});

	it.each([1, 2])('does not combine variable streams when the shorter stream skips %i cycles', (skipped) => {
		const ongoing = Array.from({length: 29}, (_, index) =>
			payment(new Date(Date.UTC(2042, index, 11)).toISOString().slice(0, 10), index % 2 ? '36.00' : '15.00'),
		);
		const other = [0, 1, 2 + skipped, 3 + skipped].map((month, index) =>
			payment(new Date(Date.UTC(2042, month, 24)).toISOString().slice(0, 10), index % 2 ? '600.00' : '300.00'),
		);
		const ongoingIds = new Set(ongoing.map(({id}) => id));
		const otherIds = new Set(other.map(({id}) => id));
		const result = detectRecurringSeries([...ongoing, ...other], '2044-05-12');
		expect(
			result.every(
				({transactionIds}) =>
					!(transactionIds.some((id) => ongoingIds.has(id)) && transactionIds.some((id) => otherIds.has(id))),
			),
		).toBe(true);
	});

	it('keeps occasional extra charges in a variable monthly bill without inventing another stream', () => {
		const amounts = ['55.00', '135.00', '85.00', '175.00', '235.00', '115.00'];
		const rows = MAY_TO_OCT.map((month, index) => payment(`${month}-20`, amounts[index]));
		const extra = payment('2026-07-20', '7.00');
		const expected = [...rows.slice(0, 3), extra, ...rows.slice(3)].map(({id}) => id);
		expect(detectRecurringSeries([...rows, extra], TODAY)).toEqual([
			expect.objectContaining({amountKind: 'VARIABLE', transactionIds: expected}),
		]);
	});

	it('does not combine overlapping variable plans into one obligation', () => {
		const dates = Array.from(
			{length: 13},
			(_, index) => `${index < 12 ? 2039 : 2040}-${String((index % 12) + 1).padStart(2, '0')}-11`,
		);
		const ongoing = dates.map((date, index) => payment(date, index % 2 ? '36.00' : '15.00'));
		const other = dates.slice(0, 4).map((date, index) => payment(date, index % 2 ? '600.00' : '300.00'));
		const result = detectRecurringSeries([...ongoing, ...other], '2040-01-12');
		// Without enough evidence to separate the plans, leave them unresolved rather than sum one false bill.
		expect(
			result.every(
				({transactionIds}) =>
					!(
						transactionIds.some((id) => ongoing.some((row) => row.id === id)) &&
						transactionIds.some((id) => other.some((row) => row.id === id))
					),
			),
		).toBe(true);
	});

	it.each([
		[
			['2030-01-31', '2030-05-01', '2030-07-31', '2030-11-01'],
			'2031-02-07',
			'QUARTERLY',
			['2031-01-31', '2031-02-01'],
		],
		[['2028-12-31', '2030-01-01'], '2030-02-01', 'YEARLY', ['2030-12-31', '2031-01-01']],
	] as const)('anchors %s near month-end rather than mid-month', (dates, asOf, cadence, nextDates) => {
		const rows = dates.map((date) => payment(date, '84.00'));
		const result = detectRecurringSeries(rows, asOf);
		expect(result).toEqual([expect.objectContaining({cadence, restartTransactionIds: []})]);
		expect(nextDates).toContain(result[0].nextExpectedDate);
		if (cadence === 'QUARTERLY') expect(result[0].status).toBe('ENDED');
	});

	it('ignores irregular payments to the same shop', () => {
		const rows = ['2026-06-02', '2026-06-20', '2026-07-30', '2026-08-04', '2026-09-27', '2026-10-01'].map((date) =>
			payment(date, '15.00'),
		);

		expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
	});

	it('splits two plans billed by one payee into separate series', () => {
		const rows = [...monthly(5, MAY_TO_OCT, '9.99'), ...monthly(5, MAY_TO_OCT, '49.00')];

		const series = detectRecurringSeries(rows, TODAY);

		expect(series.map((entry) => entry.typicalAmount).sort()).toEqual(['49.00', '9.99']);
		expect(new Set(series.map((entry) => entry.key)).size).toBe(2);
	});

	it('keeps one payer’s monthly payments as one stream through amount changes and one-off extras', () => {
		const income = {merchantKey: 'INCOME:example grants office', category: 'INCOME'} as const;
		const levels = ['300.00', '300.00', '300.00', '640.00', '640.00', '640.00', '640.00', '500.00', '500.00'];
		const levels2 = ['500.00', '220.00', '220.00', '320.00', '320.00', '320.00', '230.00', '230.00', '230.00'];
		const monthlyRows = [...levels, ...levels2].map((amount, index) =>
			payment(isoMonth(2024, 10 + index, 24), amount, income),
		);
		const extras = [
			payment('2024-12-29', '950.00', income),
			payment('2024-12-29', '310.00', income),
			payment('2025-03-22', '180.00', income),
			payment('2025-10-17', '1200.00', income),
		];
		const [series, ...rest] = detectRecurringSeries([...monthlyRows, ...extras], '2026-03-27');

		expect(rest).toEqual([]);
		expect(series).toMatchObject({
			cadence: 'MONTHLY',
			status: 'ACTIVE',
			typicalAmount: '230.00',
			transactionIds: monthlyRows.map(({id}) => id),
		});
	});

	it('keeps a salary one stream from a small start through months that vary', () => {
		const income = {merchantKey: 'INCOME:example employer', category: 'INCOME'} as const;
		const amounts = ['250.00', '250.00', '250.00', '250.00', '250.00', null, '1150.00', '1170.00', '1260.00'];
		const later = ['1330.00', '1240.00', '1500.00', '1120.00', '1220.00', '1160.00', '1210.00', '940.00', '215.00'];
		const rows = [...amounts, ...later].flatMap((amount, index) =>
			amount ? [payment(isoMonth(2024, 9 + index, 27), amount, income)] : [],
		);
		const [series, ...rest] = detectRecurringSeries(rows, '2026-03-01');

		expect(rest).toEqual([]);
		expect(series).toMatchObject({status: 'ACTIVE', transactionIds: rows.map(({id}) => id)});
	});

	it('keeps a rising variable bill when a second plan from the payer starts', () => {
		const bill = ['100.00', '140.00', '180.00', '220.00', '260.00', '300.00'].map((amount, index) =>
			payment(isoMonth(2026, 1 + index, 3), amount),
		);
		const plan = monthly(18, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'], '20.00');

		expect(detectRecurringSeries([...bill, ...plan], '2026-06-20')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({transactionIds: bill.map(({id}) => id), typicalAmount: '200.00'}),
				expect.objectContaining({transactionIds: plan.map(({id}) => id)}),
			]),
		);
	});

	it('keeps one stream when the payer also pays once from another account', () => {
		const income = {
			merchantKey: 'INCOME:example grants office',
			category: 'INCOME',
			name: 'Example Grants Office',
		} as const;
		const stream = ['100.00', '140.00', '180.00', '220.00', '260.00', '300.00'].map((amount, index) =>
			payment(isoMonth(2026, 1 + index, 24), amount, income),
		);
		const offRhythm = payment('2026-03-10', '180.00', income);
		const other = payment('2026-02-16', '15.00', {
			...income,
			bankAccountId: 'account-2',
			recurringPayeeKey: 'INCOME:example grants office',
		});
		const linked = [...stream, offRhythm].map((row) => ({
			...row,
			recurringPayeeKey: 'INCOME:example grants office',
		}));

		expect(detectRecurringSeries([...linked, other], '2026-06-26')).toEqual([
			expect.objectContaining({transactionIds: stream.map(({id}) => id), status: 'ACTIVE'}),
		]);
	});

	it('finds no bill in varying purchases with different purposes at one shop', () => {
		const shop = {merchantKey: 'EXPENSE:example marketplace'};
		// Two purchases a day apart rule out one bill; the monthly-looking rest must not become one either.
		const rows = [
			payment('2026-04-29', '86.52', {...shop, category: 'SHOPPING'}),
			payment('2026-06-01', '4.99', {...shop, category: 'SUBSCRIPTIONS'}),
			payment('2026-09-01', '86.52', {...shop, category: 'SHOPPING'}),
			payment('2026-09-28', '121.12', {...shop, category: 'SHOPPING'}),
			payment('2026-09-29', '0.49', {...shop, category: 'SHOPPING'}),
			payment('2026-10-16', '79.99', {...shop, category: 'SHOPPING'}),
		];
		expect(detectRecurringSeries(rows, '2026-10-18')).toEqual([]);
	});

	it.each(['EXPENSE', 'INCOME'] as const)(
		'classifies a small quarterly subset of irregular %s payments',
		(direction) => {
			const venue = {
				merchantKey: `${direction}:example venue`,
				name: 'Example Venue',
				category: 'ENTERTAINMENT',
			} as const;
			const quarterly = ['2034-01-12', '2034-04-12', '2034-07-12', '2034-10-12'].map((date, index) =>
				payment(date, ['17.00', '41.00', '23.00', '59.00'][index], venue),
			);
			const purchases = [
				payment('2034-02-03', '11.00', venue),
				payment('2034-02-05', '79.00', venue),
				payment('2034-05-20', '37.00', venue),
				payment('2034-08-25', '97.00', venue),
				payment('2034-09-02', '53.00', venue),
				payment('2034-10-28', '101.00', venue),
			];
			const expected = expect.objectContaining({
				direction,
				cadence: 'QUARTERLY',
				amountKind: 'VARIABLE',
				transactionIds: quarterly.map(({id}) => id),
			});
			expect(detectRecurringSeries(quarterly, '2034-10-29')).toEqual([expected]);
			expect(detectRecurringSeries([...quarterly, purchases[0]], '2034-10-29')).toEqual([expected]);
			expect(
				detectRecurringSeries(
					[...quarterly, ...purchases.map((row) => ({...row, date: '2030-01-01'}))],
					'2034-10-29',
				),
			).toEqual([expected]);
			for (const rows of [[...quarterly, ...purchases], [...quarterly, ...purchases].reverse()]) {
				expect(detectRecurringSeries(rows, '2034-10-29')).toEqual(direction === 'EXPENSE' ? [] : [expected]);
			}
		},
	);

	it('finds no varying monthly bill among frequent one-off payments', () => {
		const monthlyRows = ['2034-01', '2034-02', '2034-03', '2034-04'].map((month, index) =>
			payment(`${month}-12`, ['17.00', '41.00', '23.00', '59.00'][index]),
		);
		const extras = ['11.00', '79.00', '37.00', '97.00', '53.00'].map((amount) => payment('2034-02-01', amount));
		expect(detectRecurringSeries([...monthlyRows, ...extras], '2034-04-18')).toEqual([]);
	});

	it('keeps a varying bill whose category changes partway', () => {
		const energy = {merchantKey: 'EXPENSE:example energy'};
		const rows = ['61.20', '95.40', '48.10', '120.00', '77.70', '88.30'].map((amount, index) =>
			payment(isoMonth(2026, 3 + index, 20), amount, {
				...energy,
				category: index < 3 ? 'HOUSING_AND_UTILITIES' : 'SUBSCRIPTIONS',
			}),
		);
		expect(detectRecurringSeries(rows, '2026-08-22')).toEqual([
			expect.objectContaining({amountKind: 'VARIABLE', transactionIds: rows.map(({id}) => id)}),
		]);
	});

	it('shows an amount paid shortly before again at once, without waiting for it to repeat', () => {
		const rows = ['10.00', '10.00', '100.00', '100.00', '10.00'].map((amount, index) =>
			payment(isoMonth(2026, 1 + index, 9), amount),
		);
		expect(detectRecurringSeries(rows, '2026-05-12')).toEqual([expect.objectContaining({typicalAmount: '10.00'})]);
	});

	it('finds no recurring income in varying transfers from a person that happen to fall a month apart', () => {
		const friend = {
			merchantKey: 'INCOME:transfer from example friend',
			name: 'Transfer from EXAMPLE FRIEND',
			category: 'TRANSFER_IN',
		} as const;
		const rows = [
			payment('2024-01-26', '55.00', friend),
			payment('2024-02-25', '22.66', friend),
			payment('2024-03-31', '3.00', friend),
			payment('2024-05-03', '10.00', friend),
			payment('2024-05-31', '5.00', friend),
		];
		expect(detectRecurringSeries(rows, '2024-06-02')).toEqual([]);
	});

	it('keeps a fixed monthly transfer to a person, such as rent', () => {
		const landlord = {
			merchantKey: 'EXPENSE:example landlord',
			personTransfer: true,
			name: 'Transfer to EXAMPLE LANDLORD',
			category: 'TRANSFER_OUT',
		} as const;
		const rows = monthly(1, MAY_TO_OCT, '650.00', landlord);
		expect(detectRecurringSeries(rows, '2026-10-03')).toEqual([
			expect.objectContaining({amountKind: 'FIXED', transactionIds: rows.map(({id}) => id)}),
		]);
	});

	it('keeps weekly pay that varies with hours worked as one income stream', () => {
		const employer = {
			merchantKey: 'INCOME:example staffing payroll',
			name: 'EXAMPLE STAFFING',
			category: 'INCOME',
		} as const;
		const amounts = [
			'140.10',
			'151.80',
			'96.40',
			'182.25',
			'120.00',
			'77.80',
			'84.15',
			'133.90',
			'160.20',
			'88.60',
		];
		const rows = amounts.map((amount, index) => payment(isoMonth(2024, 1, 3 + 7 * index), amount, employer));
		const series = detectRecurringSeries(rows, '2024-03-10');
		expect(series).toEqual([
			expect.objectContaining({
				cadence: 'WEEKLY',
				amountKind: 'VARIABLE',
				direction: 'INCOME',
				transactionIds: rows.map(({id}) => id),
			}),
		]);
	});

	it('still finds no weekly bill in varying weekly shopping', () => {
		const shop = {
			merchantKey: 'EXPENSE:example corner shop',
			name: 'Example Corner Shop',
			category: 'SUBSCRIPTIONS',
		} as const;
		const amounts = ['14.10', '31.80', '9.40', '22.25', '18.00', '27.80', '8.15', '33.90'];
		const rows = amounts.map((amount, index) => payment(isoMonth(2024, 1, 3 + 7 * index), amount, shop));
		expect(detectRecurringSeries(rows, '2024-03-01')).toEqual([]);
	});

	it('does not promote two different spikes in a row', () => {
		const rows = ['10.00', '10.00', '10.00', '100.00', '300.00'].map((amount, index) =>
			payment(isoMonth(2026, 1 + index, 9), amount),
		);
		expect(detectRecurringSeries(rows, '2026-05-12')).toEqual([expect.objectContaining({typicalAmount: '10.00'})]);
	});

	it('keeps a second plan from one payer apart once it has its own monthly rhythm', () => {
		const first = monthly(
			3,
			['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
			'20.00',
		);
		const second = monthly(18, ['2026-08', '2026-09', '2026-10'], '9.00');

		expect(detectRecurringSeries([...first, ...second], '2026-10-19')).toEqual([
			expect.objectContaining({transactionIds: first.map(({id}) => id)}),
			expect.objectContaining({transactionIds: second.map(({id}) => id)}),
		]);
	});

	it('keeps a price step in one series and shows the new price with its change', () => {
		const rows = [...monthly(8, MAY_TO_OCT.slice(0, 5), '10.00'), payment('2026-10-08', '11.50')];

		const [series, ...rest] = detectRecurringSeries(rows, TODAY);

		expect(rest).toHaveLength(0);
		expect(series).toMatchObject({
			typicalAmount: '11.50',
			latestAmount: '11.50',
			monthlyEquivalent: 1150n,
			priceChange: {amount: '1.50', since: '2026-10-08'},
			flags: [],
		});
	});

	it('shows a price drop until the new price has been paid three times', () => {
		const older = monthly(23, ['2026-01', '2026-02', '2026-03', '2026-04'], '12.00', {
			merchantKey: 'EXPENSE:example mobile',
		});
		const newer = monthly(23, ['2026-05', '2026-06', '2026-07', '2026-08'], '8.50', {
			merchantKey: 'EXPENSE:example mobile',
		});
		const change = (count: number) =>
			detectRecurringSeries([...older, ...newer.slice(0, count)], soonAfter(newer[count - 1].date))[0]
				.priceChange;

		expect(change(1)).toEqual({amount: '-3.50', since: '2026-05-23'});
		expect(change(2)).toEqual({amount: '-3.50', since: '2026-05-23'});
		expect(change(3)).toEqual({amount: '-3.50', since: '2026-05-23'});
		expect(change(4)).toBeNull();
		// A series no longer paid has no current price to compare.
		expect(detectRecurringSeries([...older, newer[0]], '2026-08-01')[0]).toMatchObject({
			status: 'ENDED',
			priceChange: null,
		});
	});

	it('shows no price change for small differences or a variable bill', () => {
		const jitter = ['9.00', '9.30', '9.00', '9.00', '9.20', '9.00'].map((amount, index) =>
			payment(`2026-0${index + 3}-05`, amount, {merchantKey: 'EXPENSE:example jitter'}),
		);
		const variable = ['40.00', '25.00', '100.00', '75.00', '60.00', '50.00'].map((amount, index) =>
			payment(`2026-0${index + 3}-12`, amount, {merchantKey: 'EXPENSE:example energy'}),
		);

		expect(detectRecurringSeries(jitter, '2026-08-06')).toEqual([
			expect.objectContaining({amountKind: 'FIXED', typicalAmount: '9.00', priceChange: null}),
		]);
		expect(detectRecurringSeries(variable, '2026-08-13')).toEqual([
			expect.objectContaining({amountKind: 'VARIABLE', typicalAmount: '55.00', priceChange: null}),
		]);
	});

	it('shows the median of a variable bill, which a one-off spike barely moves', () => {
		const amounts = ['8.00', '11.00', '8.00', '25.00', '11.00', '4.75', '4.75', '5.25', '4.75', '36.00'];
		const rows = amounts.map((amount, index) =>
			payment(isoMonth(2025, 12 + index, 23), amount, {merchantKey: 'EXPENSE:example phone'}),
		);
		const shown = (count: number, next: string[] = []) => {
			const extra = next.map((amount, index) =>
				payment(isoMonth(2025, 12 + count + index, 23), amount, {merchantKey: 'EXPENSE:example phone'}),
			);
			const history = [...rows.slice(0, count), ...extra];
			return detectRecurringSeries(history, soonAfter(history[history.length - 1].date));
		};

		// 36.00 is flagged, and the month it was paid in costs it, but the shown amount stays near the usual 5.00.
		expect(shown(10)).toEqual([
			expect.objectContaining({
				amountKind: 'VARIABLE',
				typicalAmount: '5.00',
				latestAmount: '36.00',
				monthlyEquivalent: 3600n,
				flags: ['HIGHER_THAN_USUAL'],
			}),
		]);
		// Paid again, it is no longer above what came before.
		expect(shown(10, ['35.80'])).toEqual([
			expect.objectContaining({typicalAmount: '5.00', monthlyEquivalent: 3580n, flags: []}),
		]);
		// A small bill doubling is under 5.00 away: a fixed price change, shown at once and never flagged.
		const small = ['2.00', '2.40', '2.00', '2.20', '4.50'].map((amount, index) =>
			payment(isoMonth(2026, 3 + index, 9), amount, {merchantKey: 'EXPENSE:example small bill'}),
		);
		expect(detectRecurringSeries(small, '2026-07-12')).toEqual([
			expect.objectContaining({amountKind: 'FIXED', typicalAmount: '4.50', flags: []}),
		]);
		expect(shown(10, ['6.50'])).toEqual([
			expect.objectContaining({typicalAmount: '5.00', monthlyEquivalent: 650n, flags: []}),
		]);
	});

	it.each([
		['increase', '18.00', '42.00', 4200n],
		['decrease', '42.00', '18.00', 1800n],
	] as const)('joins sequential fixed prices after a large %s', (_label, oldPrice, newPrice, cost) => {
		const older = monthly(8, ['2026-02', '2026-03', '2026-04', '2026-05'], oldPrice);
		const newer = monthly(8, ['2026-06', '2026-07', '2026-08'], newPrice);
		const rows = [...older, ...newer];

		expect(detectRecurringSeries(rows, '2026-08-10')).toEqual([
			expect.objectContaining({
				cadence: 'MONTHLY',
				amountKind: 'FIXED',
				typicalAmount: newPrice,
				latestAmount: newPrice,
				monthlyEquivalent: cost,
				transactionIds: rows.map(({id}) => id),
			}),
		]);
	});

	it.each([11, 24])('joins successive prices without consuming a concurrent plan billed on day %i', (day) => {
		const older = monthly(11, ['2028-02', '2028-03', '2028-04'], '27.00');
		const newer = monthly(
			11,
			['2028-05', '2028-06', '2028-07', '2028-08', '2028-09', '2028-10', '2028-11'],
			'64.00',
		);
		const concurrent = monthly(
			day,
			[
				'2028-02',
				'2028-03',
				'2028-04',
				'2028-05',
				'2028-06',
				'2028-07',
				'2028-08',
				'2028-09',
				'2028-10',
				'2028-11',
			],
			'103.00',
		);
		const before = detectRecurringSeries([...older, ...concurrent.slice(0, 3)], '2028-04-25');
		const prior = before.find(({transactionIds}) => transactionIds.includes(older[0].id))!;
		const sibling = before.find(({transactionIds}) => transactionIds.includes(concurrent[0].id))!;

		const result = detectRecurringSeries([...older, ...newer, ...concurrent], '2028-11-25');

		expect(result).toHaveLength(2);
		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: prior.key,
					cadence: 'MONTHLY',
					amountKind: 'FIXED',
					typicalAmount: '64.00',
					monthlyEquivalent: 6400n,
					status: 'ACTIVE',
					transactionIds: [...older, ...newer].map(({id}) => id),
				}),
				expect.objectContaining({
					key: sibling.key,
					typicalAmount: '103.00',
					monthlyEquivalent: 10300n,
					transactionIds: concurrent.map(({id}) => id),
				}),
			]),
		);
	});

	it('retains an unambiguous trailing outlier when a concurrent plan blocks whole-partition reconciliation', () => {
		const older = monthly(11, ['2034-02', '2034-03', '2034-04', '2034-05'], '27.00');
		const newer = monthly(11, ['2034-06', '2034-07', '2034-08'], '64.00');
		const outlier = payment('2034-09-11', '175.00');
		const history = [...older, ...newer, outlier];
		const concurrent = monthly(
			24,
			['2034-02', '2034-03', '2034-04', '2034-05', '2034-06', '2034-07', '2034-08'],
			'250.00',
		);
		const before = detectRecurringSeries(history, '2034-09-12')[0];

		expect(detectRecurringSeries([...history, ...concurrent], '2034-09-12')).toEqual([
			expect.objectContaining({
				key: before.key,
				typicalAmount: '64.00',
				latestAmount: '175.00',
				monthlyEquivalent: 6400n,
				nextExpectedDate: '2034-10-11',
				flags: [],
				transactionIds: history.map(({id}) => id),
			}),
			expect.objectContaining({transactionIds: concurrent.map(({id}) => id)}),
		]);
	});

	it('does not assign an isolated payment that fits two established streams', () => {
		const older = monthly(11, ['2035-02', '2035-03', '2035-04'], '27.00');
		const newer = monthly(11, ['2035-05', '2035-06', '2035-07'], '64.00');
		const concurrent = monthly(11, ['2035-02', '2035-03', '2035-04', '2035-05', '2035-06', '2035-07'], '103.00');
		const outlier = payment('2035-08-11', '175.00');

		expect(detectRecurringSeries([...older, ...newer, ...concurrent, outlier], '2035-08-12')).toEqual([
			expect.objectContaining({transactionIds: [...older, ...newer].map(({id}) => id)}),
			expect.objectContaining({transactionIds: concurrent.map(({id}) => id)}),
		]);
	});

	it('does not choose between isolated payments competing for one cadence slot', () => {
		const older = monthly(11, ['2035-02', '2035-03', '2035-04'], '27.00');
		const newer = monthly(11, ['2035-05', '2035-06', '2035-07'], '64.00');
		const concurrent = monthly(24, ['2035-02', '2035-03', '2035-04', '2035-05', '2035-06', '2035-07'], '103.00');
		const outliers = [payment('2035-08-11', '175.00'), payment('2035-08-11', '400.00')];
		const rows = [...older, ...newer, ...concurrent, ...outliers];

		for (const input of [rows, [...rows].reverse()]) {
			expect(detectRecurringSeries(input, '2035-08-12')).toEqual([
				expect.objectContaining({transactionIds: [...older, ...newer].map(({id}) => id)}),
				expect.objectContaining({transactionIds: concurrent.map(({id}) => id)}),
			]);
		}
	});

	it('retains an isolated payment in an unambiguous interior cadence slot', () => {
		const older = monthly(11, ['2035-01', '2035-02', '2035-03'], '27.00');
		const newer = monthly(11, ['2035-04', '2035-05', '2035-07', '2035-08'], '64.00');
		const outlier = payment('2035-06-11', '175.00');
		const history = [...older, ...newer.slice(0, 2), outlier, ...newer.slice(2)];
		const concurrent = monthly(
			24,
			['2035-01', '2035-02', '2035-03', '2035-04', '2035-05', '2035-06', '2035-07', '2035-08'],
			'250.00',
		);

		expect(detectRecurringSeries([...history, ...concurrent], '2035-08-25')).toEqual([
			expect.objectContaining({
				typicalAmount: '64.00',
				monthlyEquivalent: 6400n,
				transactionIds: history.map(({id}) => id),
			}),
			expect.objectContaining({transactionIds: concurrent.map(({id}) => id)}),
		]);
	});

	it('retains a unique trailing outlier despite competing payments in an unrelated interior slot', () => {
		const older = monthly(11, ['2037-01', '2037-02', '2037-03'], '29.00');
		const newer = monthly(11, ['2037-04', '2037-05', '2037-07', '2037-08'], '68.00');
		const competing = [payment('2037-06-11', '177.00'), payment('2037-06-11', '410.00')];
		const trailing = payment('2037-09-11', '725.00');
		const concurrent = monthly(
			24,
			['2037-01', '2037-02', '2037-03', '2037-04', '2037-05', '2037-06', '2037-07', '2037-08'],
			'255.00',
		);

		expect(
			detectRecurringSeries([...older, ...newer, ...competing, trailing, ...concurrent], '2037-09-12'),
		).toEqual([
			expect.objectContaining({
				typicalAmount: '68.00',
				latestAmount: '725.00',
				monthlyEquivalent: 6800n,
				flags: [],
				transactionIds: [...older, ...newer, trailing].map(({id}) => id),
			}),
			expect.objectContaining({transactionIds: concurrent.map(({id}) => id)}),
		]);
	});

	it('retains repeated isolated amounts that never establish their own cadence', () => {
		const months = Array.from({length: 16}, (_, index) =>
			new Date(Date.UTC(2037, index, 1)).toISOString().slice(0, 7),
		);
		const older = monthly(11, months.slice(0, 3), '29.00');
		const newer = monthly(
			11,
			months.slice(3, 15).filter((month) => month !== '2037-07' && month !== '2037-11'),
			'68.00',
		);
		const outliers = monthly(11, ['2037-07', '2037-11', '2038-04'], '177.00');
		const history = [...older, ...newer, ...outliers].sort((a, b) => a.date.localeCompare(b.date));
		const concurrent = monthly(24, months.slice(0, 15), '255.00');
		const before = detectRecurringSeries(history, '2038-04-12')[0];

		expect(before.transactionIds).toEqual(history.map(({id}) => id));
		expect(detectRecurringSeries([...history, ...concurrent], '2038-04-12')).toEqual([
			expect.objectContaining({
				key: before.key,
				typicalAmount: '68.00',
				latestAmount: '177.00',
				monthlyEquivalent: 6800n,
				flags: [],
				transactionIds: history.map(({id}) => id),
			}),
			expect.objectContaining({transactionIds: concurrent.map(({id}) => id)}),
		]);
	});

	it.each(['predecessors', 'successors'] as const)(
		'keeps ambiguous successive-price %s separate instead of choosing by input order',
		(alternatives) => {
			const earlierMonths = ['2029-04', '2029-05', '2029-06'];
			const laterMonths = ['2029-07', '2029-08', '2029-09'];
			const older = monthly(11, earlierMonths, '27.00');
			const newer = monthly(11, laterMonths, '64.00');
			const competing = monthly(13, alternatives === 'predecessors' ? earlierMonths : laterMonths, '103.00');
			const streams = [older, newer, competing];
			const rows = streams.flat();

			for (const input of [rows, [...rows].reverse()]) {
				const result = detectRecurringSeries(input, '2029-09-25');

				expect(result).toHaveLength(3);
				expect(result).toEqual(
					expect.arrayContaining(
						streams.map((stream) =>
							expect.objectContaining({
								amountKind: 'FIXED',
								transactionIds: stream.map(({id}) => id),
							}),
						),
					),
				);
			}
		},
	);

	it('follows multiple unique price transitions alongside a concurrent plan', () => {
		const first = monthly(11, ['2029-04', '2029-05', '2029-06'], '27.00');
		const second = monthly(11, ['2029-07', '2029-08', '2029-09'], '64.00');
		const third = monthly(11, ['2029-10', '2029-11', '2029-12'], '12.00');
		const concurrent = monthly(
			24,
			['2029-04', '2029-05', '2029-06', '2029-07', '2029-08', '2029-09', '2029-10', '2029-11', '2029-12'],
			'103.00',
		);

		expect(detectRecurringSeries([...first, ...second, ...third, ...concurrent], '2029-12-25')).toEqual([
			expect.objectContaining({
				amountKind: 'FIXED',
				typicalAmount: '12.00',
				monthlyEquivalent: 1200n,
				transactionIds: [...first, ...second, ...third].map(({id}) => id),
			}),
			expect.objectContaining({transactionIds: concurrent.map(({id}) => id)}),
		]);
	});

	it('retains valid histories when a longer price chain no longer matches the cadence', () => {
		const older = ['2032-01-01', '2032-01-26', '2032-03-01'].map((date) => payment(date, '27.00'));
		const middle = ['2032-03-28', '2032-04-22', '2032-05-22', '2032-06-26'].map((date) => payment(date, '64.00'));
		const newer = ['2032-07-23', '2032-08-17', '2032-09-21'].map((date) => payment(date, '103.00'));
		const rows = [...older, ...middle, ...newer];

		for (const input of [rows, [...rows].reverse()]) {
			expect(detectRecurringSeries(input, '2032-09-22')).toEqual([
				expect.objectContaining({
					cadence: 'MONTHLY',
					typicalAmount: '64.00',
					transactionIds: [...older, ...middle].map(({id}) => id),
				}),
				expect.objectContaining({
					cadence: 'MONTHLY',
					typicalAmount: '103.00',
					transactionIds: newer.map(({id}) => id),
				}),
			]);
		}
	});

	it('keeps prorated interruptions inside sustained sequential prices', () => {
		const rows = [
			...monthly(8, ['2026-01', '2026-02', '2026-03', '2026-04'], '18.00'),
			payment('2026-05-08', '7.00'),
			...monthly(8, ['2026-06', '2026-07', '2026-08'], '42.00'),
			payment('2026-09-08', '12.00'),
			payment('2026-10-08', '42.00'),
		];

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({
				amountKind: 'FIXED',
				typicalAmount: '42.00',
				monthlyEquivalent: 4200n,
				transactionIds: rows.map(({id}) => id),
			}),
		]);
	});

	it('does not replace the established price with one isolated latest outlier', () => {
		const rows = [
			...monthly(8, ['2026-01', '2026-02', '2026-03', '2026-04'], '42.00'),
			...monthly(8, ['2026-05', '2026-06', '2026-07'], '18.00'),
			payment('2026-08-08', '90.00'),
		];

		expect(detectRecurringSeries(rows, '2026-08-12')).toEqual([
			expect.objectContaining({
				amountKind: 'FIXED',
				typicalAmount: '18.00',
				latestAmount: '90.00',
				monthlyEquivalent: 1800n,
				flags: [],
				transactionIds: rows.map(({id}) => id),
			}),
		]);
	});

	it('does not label an isolated outlier as the new price after an established increase', () => {
		const rows = [
			...monthly(8, ['2026-01', '2026-02', '2026-03', '2026-04'], '18.00'),
			...monthly(8, ['2026-05', '2026-06', '2026-07'], '42.00'),
			payment('2026-08-08', '90.00'),
		];

		expect(detectRecurringSeries(rows, '2026-08-12')).toEqual([
			expect.objectContaining({
				typicalAmount: '42.00',
				latestAmount: '90.00',
				monthlyEquivalent: 4200n,
				flags: [],
			}),
		]);
	});

	it('keeps sustained prices that return to a previous amount in one fixed stream', () => {
		const rows = [
			...monthly(8, ['2026-02', '2026-03', '2026-04'], '18.00'),
			...monthly(8, ['2026-05', '2026-06', '2026-07'], '42.00'),
			...monthly(8, ['2026-08', '2026-09', '2026-10'], '18.00'),
		];

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({
				amountKind: 'FIXED',
				typicalAmount: '18.00',
				monthlyEquivalent: 1800n,
				transactionIds: rows.map(({id}) => id),
			}),
		]);
	});

	it.each([8, 20])('keeps streams with an overlapping billing cycle apart on day %i', (day) => {
		const older = monthly(8, ['2026-01', '2026-02', '2026-03', '2026-04'], '18.00');
		const newer = monthly(day, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'], '42.00');

		expect(detectRecurringSeries([...older, ...newer], TODAY)).toEqual([
			expect.objectContaining({amountKind: 'FIXED', transactionIds: older.map(({id}) => id)}),
			expect.objectContaining({amountKind: 'FIXED', transactionIds: newer.map(({id}) => id)}),
		]);
	});

	it('keeps interleaved established chains separate when skipped cycles hide concurrent plans', () => {
		const older = monthly(11, ['2030-04', '2030-05', '2030-06', '2030-08'], '27.00');
		const newer = monthly(11, ['2030-07', '2030-09', '2030-10', '2030-11'], '64.00');
		const rows = [...older, ...newer];

		for (const input of [rows, [...rows].reverse()]) {
			expect(detectRecurringSeries(input, '2030-11-12')).toEqual([
				expect.objectContaining({transactionIds: older.map(({id}) => id), typicalAmount: '27.00'}),
				expect.objectContaining({transactionIds: newer.map(({id}) => id), typicalAmount: '64.00'}),
			]);
		}
	});

	it('joins prices across two billing dates in the same calendar month', () => {
		const rows = ['2026-03-01', '2026-03-31', '2026-05-01', '2026-05-30', '2026-07-01', '2026-07-31'].map(
			(date, index) => payment(date, index < 3 ? '18.00' : '42.00'),
		);
		const before = detectRecurringSeries(rows.slice(0, 3), '2026-05-02')[0];

		const result = detectRecurringSeries(rows, '2026-08-10');
		expect(result).toEqual([
			expect.objectContaining({
				key: before.key,
				amountKind: 'FIXED',
				typicalAmount: '42.00',
				monthlyEquivalent: 4200n,
				transactionIds: rows.map(({id}) => id),
				restartTransactionIds: [],
				status: 'ACTIVE',
			}),
		]);
		expect(['2026-08-31', '2026-09-01']).toContain(result[0].nextExpectedDate);
	});

	it('keeps alternating prices variable rather than treating repeated values as stable periods', () => {
		const rows = MAY_TO_OCT.map((month, index) => payment(`${month}-08`, index % 2 ? '42.00' : '18.00'));

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({
				amountKind: 'VARIABLE',
				// The median sits between the two amounts; this month costs what was paid in it.
				typicalAmount: '30.00',
				monthlyEquivalent: 4200n,
				flags: [],
				transactionIds: rows.map(({id}) => id),
			}),
		]);
	});

	it('keeps the five-day late window after reconciling prices', () => {
		const rows = [...monthly(12, MAY_TO_OCT.slice(0, 3), '18.00'), ...monthly(12, MAY_TO_OCT.slice(3), '42.00')];
		const on = (today: string) => detectRecurringSeries(rows, today)[0];

		expect(on('2026-11-12')).toMatchObject({amountKind: 'FIXED', status: 'ACTIVE', nextExpectedDate: '2026-11-12'});
		expect(on('2026-11-13')).toMatchObject({status: 'ACTIVE', flags: expect.arrayContaining(['LATE'])});
		expect(on('2026-11-17')).toMatchObject({status: 'ACTIVE', flags: expect.arrayContaining(['LATE'])});
		expect(on('2026-11-18')).toMatchObject({status: 'ENDED', flags: []});
	});

	it('requires converted amounts for the entire reconciled history', () => {
		const rows = [
			...monthly(8, MAY_TO_OCT.slice(0, 3), '18.00', {baseAmountCents: 2000n}),
			...monthly(8, MAY_TO_OCT.slice(3), '42.00', {baseAmountCents: 4500n}),
		];

		expect(detectRecurringSeries(rows, TODAY)[0]).toMatchObject({typicalAmount: '42.00', monthlyEquivalent: 4500n});
		rows[0].baseAmountCents = null;
		expect(detectRecurringSeries(rows, TODAY)[0]).toMatchObject({typicalAmount: '42.00', monthlyEquivalent: null});
	});

	it.each([
		{bankAccountId: 'account-2'},
		{currency: 'GBP'},
		{merchantKey: 'INCOME:example gym'},
		{merchantKey: 'EXPENSE:other example gym'},
	])('never reconciles prices across partition boundaries %j', (overrides) => {
		const older = monthly(8, MAY_TO_OCT.slice(0, 3), '18.00');
		const newer = monthly(8, MAY_TO_OCT.slice(3), '42.00', overrides);

		expect(detectRecurringSeries([...older, ...newer], TODAY)).toEqual([
			expect.objectContaining({transactionIds: older.map(({id}) => id), typicalAmount: '18.00'}),
			expect.objectContaining({transactionIds: newer.map(({id}) => id), typicalAmount: '42.00'}),
		]);
	});

	it('does not join established prices with different cadences', () => {
		const quarterly = ['2025-10-08', '2026-01-08', '2026-04-08'].map((date) => payment(date, '18.00'));
		const monthlyRows = monthly(8, MAY_TO_OCT, '42.00');

		expect(detectRecurringSeries([...quarterly, ...monthlyRows], TODAY)).toEqual([
			expect.objectContaining({cadence: 'QUARTERLY', transactionIds: quarterly.map(({id}) => id)}),
			expect.objectContaining({cadence: 'MONTHLY', transactionIds: monthlyRows.map(({id}) => id)}),
		]);
	});

	it('does not flag a small price change', () => {
		const rows = [...monthly(8, MAY_TO_OCT.slice(0, 5), '10.00'), payment('2026-10-08', '10.40')];

		expect(detectRecurringSeries(rows, TODAY)[0].flags).toEqual([]);
	});

	it('detects a monthly bill whose amount varies as one variable series', () => {
		const amounts = ['61.20', '95.40', '48.10', '120.00', '77.70', '88.30'];
		const rows = MAY_TO_OCT.map((month, index) => payment(`${month}-20`, amounts[index]));

		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({
				cadence: 'MONTHLY',
				amountKind: 'VARIABLE',
				typicalAmount: '83.00',
				monthlyEquivalent: 8830n,
				flags: [],
			}),
		]);
	});

	it('does not treat weekly variable spending as a bill', () => {
		const amounts = ['31.20', '55.10', '12.40', '80.00', '44.40'];
		const rows = ['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17'].map((date, index) =>
			payment(date, amounts[index]),
		);

		expect(detectRecurringSeries(rows, TODAY)).toEqual([]);
	});

	it('shows a missed payment as late for five days, then stops the series', () => {
		const rows = monthly(12, ['2026-06', '2026-07', '2026-08', '2026-09'], '20.00');
		const on = (today: string) => detectRecurringSeries(rows, today)[0];

		expect(on('2026-10-12')).toMatchObject({nextExpectedDate: '2026-10-12', status: 'ACTIVE', flags: []});
		expect(on('2026-10-13')).toMatchObject({status: 'ACTIVE', flags: ['LATE']});
		expect(on('2026-10-17')).toMatchObject({status: 'ACTIVE', flags: ['LATE']});
		expect(on('2026-10-18')).toMatchObject({status: 'ENDED', flags: []});
	});

	it('is active again when a late payment arrives after the series had stopped', () => {
		const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
		const rows = [...monthly(1, months, '20.00'), payment('2026-09-11', '20.00')];

		expect(detectRecurringSeries(rows, '2026-09-20')[0]).toMatchObject({
			status: 'ACTIVE',
			flags: [],
			transactionIds: rows.map(({id}) => id),
			restartTransactionIds: [rows[6].id],
		});
	});

	it('counts a payment made a few days early as the month it was due in', () => {
		const rows = ['2026-04-01', '2026-05-01', '2026-05-29', '2026-07-01', '2026-08-01', '2026-08-30'].map((date) =>
			payment(date, '20.00'),
		);

		expect(detectRecurringSeries(rows, '2026-09-10')[0]).toMatchObject({
			nextExpectedDate: '2026-10-01',
			status: 'ACTIVE',
			flags: [],
			restartTransactionIds: [],
		});
	});

	it.each([
		[4, '2026-06-25', ['2026-06-30', '2026-07-01']],
		[5, '2026-07-10', ['2026-08-01']],
	] as const)(
		'keeps an even mix of boundary days anchored at month-end with %i payments',
		(count, today, nextDates) => {
			const rows = ['2026-03-01', '2026-03-30', '2026-05-01', '2026-05-30', '2026-07-01']
				.slice(0, count)
				.map((date) => payment(date, '20.00'));

			const [series] = detectRecurringSeries(rows, today);

			expect(series).toMatchObject({
				cadence: 'MONTHLY',
				status: 'ACTIVE',
				flags: [],
				transactionIds: rows.map(({id}) => id),
				restartTransactionIds: [],
			});
			// The usual day lies between the 30th and the 1st, never halfway through the month.
			expect(nextDates).toContain(series.nextExpectedDate);
		},
	);

	it.each([
		[[20, 20, 20, 3, 3, 3], '2026-11-03'],
		[[3, 3, 3, 20, 20, 20], '2026-11-20'],
	] as const)('follows a billing day that moved, for monthly days %j', (days, nextExpectedDate) => {
		const rows = MAY_TO_OCT.map((month, index) =>
			payment(`${month}-${String(days[index]).padStart(2, '0')}`, '20.00'),
		);

		expect(detectRecurringSeries(rows, '2026-10-21')[0]).toMatchObject({
			cadence: 'MONTHLY',
			status: 'ACTIVE',
			flags: [],
			nextExpectedDate,
		});
	});

	it('does not treat one early second payment as a moved billing day', () => {
		const rows = ['2026-01-10', '2026-02-04', '2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10'].map((date) =>
			payment(date, '20.00'),
		);

		expect(detectRecurringSeries(rows, '2026-06-12')[0]).toMatchObject({
			cadence: 'MONTHLY',
			status: 'ACTIVE',
			restartTransactionIds: [],
			nextExpectedDate: '2026-07-10',
		});
	});

	it('marks a payment after the grace period as a restart even when older history is added', () => {
		const rows = ['2026-05-05', '2026-06-05', '2026-07-11', '2026-08-05', '2026-09-05', '2026-10-05'].map(
			(date, index) => payment(date, index < 3 ? '10.00' : '20.00'),
		);

		expect(detectRecurringSeries(rows, TODAY)[0]).toMatchObject({
			amountKind: 'FIXED',
			typicalAmount: '20.00',
			restartTransactionIds: [rows[2].id],
		});
	});

	it.each([
		[[8, 10, 12, 10, 14, 14], '2026-11-11'],
		[[13, 14, 15, 16, 18, 18], '2026-11-16'],
		[[25, 27, 29, 27, 29, 29], '2026-11-28'],
	] as const)('keeps the historical median for monthly days %j', (days, nextExpectedDate) => {
		const rows = MAY_TO_OCT.map((month, index) =>
			payment(`${month}-${String(days[index]).padStart(2, '0')}`, '20.00'),
		);

		expect(detectRecurringSeries(rows, TODAY)[0]).toMatchObject({nextExpectedDate});
	});

	it.each([
		[['2026-11-30', '2027-01-01', '2027-01-31'], '2027-02-28'],
		[['2027-11-30', '2028-01-01', '2028-01-31'], '2028-02-29'],
	] as const)('clamps a boundary anchor after year rollover from %j', (dates, nextExpectedDate) => {
		const rows = dates.map((date) => payment(date, '20.00'));

		expect(detectRecurringSeries(rows, dates[dates.length - 1])[0]).toMatchObject({
			nextExpectedDate,
			restartTransactionIds: [],
		});
	});

	it.each(
		[2026, 2027, 2028].flatMap((year) =>
			[1, 2, 30, 31].flatMap((day) =>
				[
					[0, -1],
					[0, -2],
					[-1, 0],
					[1, 0],
					[0, 1],
					[-1, 1],
					[0, -1, 0, 1],
				].map((drift) => ({
					year,
					day,
					drift,
				})),
			),
		),
	)('keeps generated boundary histories near day $day from $year with drift $drift', ({year, day, drift}) => {
		// Starting in October crosses the year boundary and both ordinary and leap Februaries.
		const due = (month: number) =>
			Date.UTC(year, month, Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()));
		const rows = Array.from({length: 8}, (_, index) =>
			payment(
				new Date(due(9 + index) + drift[index % drift.length] * 86_400_000).toISOString().slice(0, 10),
				'20.00',
			),
		);

		for (let count = 3; count <= rows.length; count++) {
			const prefix = rows.slice(0, count);
			const result = detectRecurringSeries(prefix, prefix[count - 1].date);
			expect(result).toEqual([
				expect.objectContaining({
					cadence: 'MONTHLY',
					transactionIds: prefix.map(({id}) => id),
					restartTransactionIds: [],
					status: 'ACTIVE',
					flags: [],
				}),
			]);
			const forecastDrift = (Date.parse(result[0].nextExpectedDate) - due(9 + count)) / 86_400_000;
			expect(Math.abs(forecastDrift)).toBeLessThanOrEqual(2);
		}
	});

	it('marks a stopped series ended without flagging its old price', () => {
		const rows = [...monthly(1, ['2026-03', '2026-04', '2026-05'], '20.00'), payment('2026-06-01', '22.00')];

		expect(detectRecurringSeries(rows, TODAY)[0]).toMatchObject({status: 'ENDED', flags: []});
	});

	it('finds a yearly bill from two payments but never a yearly transfer to a person', () => {
		const insurer = [payment('2025-09-12', '120.00'), payment('2026-09-14', '120.00')].map((row) => ({
			...row,
			merchantKey: 'EXPENSE:example insurer',
		}));
		const friend = [payment('2025-08-05', '47.00'), payment('2026-08-04', '47.00')].map((row) => ({
			...row,
			merchantKey: 'EXPENSE:alex-sam example',
			personTransfer: true,
		}));
		const counterpartyFriend = [payment('2025-07-02', '30.00'), payment('2026-07-01', '30.00')].map((row) => ({
			...row,
			merchantKey: 'EXPENSE:sam other',
			category: 'TRANSFER_OUT' as const,
		}));

		// A named person seen elsewhere as a transfer, now under a plain counterparty name.
		const knownPerson = [payment('2025-06-03', '25.00'), payment('2026-06-02', '25.00')].map((row) => ({
			...row,
			merchantKey: 'EXPENSE:jo sample',
		}));
		const knownPersonTransfer = {
			...payment('2026-01-15', '5.00'),
			merchantKey: 'EXPENSE:jo sample',
			personTransfer: true,
		};
		// Two transfers a year apart beside one uncategorised payment to the same payee.
		const mixed = [
			{...payment('2025-05-10', '40.00'), category: 'TRANSFER_OUT' as const},
			{...payment('2026-01-20', '12.00'), category: null},
			{...payment('2026-05-09', '40.00'), category: 'TRANSFER_OUT' as const},
		].map((row) => ({...row, merchantKey: 'EXPENSE:pat mixed'}));

		const rows = [...insurer, ...friend, ...counterpartyFriend, ...knownPerson, knownPersonTransfer, ...mixed];
		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({cadence: 'YEARLY', transactionIds: insurer.map(({id}) => id)}),
		]);
	});

	it('still finds a monthly transfer to a person', () => {
		const rows = monthly(28, MAY_TO_OCT.slice(0, 5), '650.00', {
			merchantKey: 'EXPENSE:alex-sam example',
			personTransfer: true,
			category: 'TRANSFER_OUT',
		});

		expect(detectRecurringSeries(rows, TODAY)).toEqual([expect.objectContaining({cadence: 'MONTHLY'})]);
	});

	it('clamps a month-end payment day to shorter months', () => {
		const rows = [payment('2026-07-31', '5.00'), payment('2026-08-31', '5.00'), payment('2026-09-30', '5.00')];

		expect(detectRecurringSeries(rows, TODAY)[0].nextExpectedDate).toBe('2026-10-31');
		expect(detectRecurringSeries(rows.slice(0, 2), TODAY)).toEqual([]);
	});

	it('never mixes currencies and leaves the monthly cost empty until every row is converted', () => {
		const rows = [
			...monthly(2, MAY_TO_OCT, '10.00'),
			...monthly(2, MAY_TO_OCT, '10.00', {currency: 'GBP', baseAmountCents: 1150n}),
		];
		rows[rows.length - 1].baseAmountCents = null;

		const series = detectRecurringSeries(rows, TODAY);

		expect(series.map(({currency, monthlyEquivalent}) => ({currency, monthlyEquivalent}))).toEqual(
			expect.arrayContaining([
				{currency: 'EUR', monthlyEquivalent: 1000n},
				{currency: 'GBP', monthlyEquivalent: null},
			]),
		);
	});

	it('reports recurring income with its direction', () => {
		const rows = [
			...monthly(25, MAY_TO_OCT.slice(0, 5), '2500.00', {merchantKey: 'INCOME:example employer'}),
			payment('2026-10-25', '2700.00', {merchantKey: 'INCOME:example employer'}),
		];

		expect(detectRecurringSeries(rows, '2026-10-26')[0]).toMatchObject({
			direction: 'INCOME',
			cadence: 'MONTHLY',
			flags: [],
		});
	});

	it('keeps the series key when a new payment arrives', () => {
		const rows = monthly(3, MAY_TO_OCT.slice(0, 5), '29.99');
		const [before] = detectRecurringSeries(rows, '2026-09-20');
		const [after] = detectRecurringSeries([...rows, payment('2026-10-03', '29.99')], TODAY);

		expect(after.key).toBe(before.key);
		expect(after.transactionIds).toHaveLength(6);
	});

	it.each(['alex-sam example', 'alex example', 'alex-jo example'])('keeps the full payee identity %s', (laterKey) => {
		const older = monthly(28, ['2026-05', '2026-06', '2026-07'], '650.00', {
			merchantKey: 'EXPENSE:alex-sam example',
			personTransfer: true,
			name: 'Transfer to ALEX-SAM EXAMPLE',
		});
		const newer = monthly(28, ['2026-08', '2026-09', '2026-10'], '650.00', {
			merchantKey: `EXPENSE:${laterKey}`,
			name: laterKey,
		});

		const expected = laterKey === 'alex-sam example' ? [[...older, ...newer]] : [older, newer];
		expect(detectRecurringSeries([...older, ...newer], TODAY).map(({transactionIds}) => transactionIds)).toEqual(
			expected.map((rows) => rows.map(({id}) => id)),
		);
	});

	it('groups transfers from a person the same way', () => {
		const older = monthly(1, ['2026-05', '2026-06', '2026-07'], '40.00', {
			merchantKey: 'INCOME:alex-sam example',
			personTransfer: true,
			name: 'Transfer from ALEX-SAM EXAMPLE',
		});
		const newer = monthly(1, ['2026-08', '2026-09', '2026-10'], '40.00', {
			merchantKey: 'INCOME:alex-sam example',
			name: 'Alex-Sam Example',
		});

		expect(detectRecurringSeries([...older, ...newer], TODAY)).toEqual([
			expect.objectContaining({direction: 'INCOME', transactionIds: [...older, ...newer].map(({id}) => id)}),
		]);
	});

	it('does not treat a one-word transfer name as a person', () => {
		// Same amount, so only the payee grouping keeps them apart.
		const transfers = monthly(28, MAY_TO_OCT, '50.00', {merchantKey: 'EXPENSE:transfer to example'});
		const shop = monthly(12, MAY_TO_OCT, '50.00', {merchantKey: 'EXPENSE:example'});

		expect(
			detectRecurringSeries([...transfers, ...shop], TODAY).map(({transactionIds}) => transactionIds.length),
		).toEqual([6, 6]);
	});

	it('keeps each bank account’s payments to one payee apart', () => {
		const bill = monthly(23, MAY_TO_OCT, '12.00', {merchantKey: 'EXPENSE:example mobile'});
		// Irregular top-ups to the same payee from another account.
		const topUps = ['2026-05-01', '2026-05-09', '2026-06-14', '2026-08-02', '2026-08-05'].map((date) =>
			payment(date, '2.50', {merchantKey: 'EXPENSE:example mobile', bankAccountId: 'account-2'}),
		);

		expect(detectRecurringSeries([...bill, ...topUps], TODAY)).toEqual([
			expect.objectContaining({cadence: 'MONTHLY', transactionIds: bill.map(({id}) => id)}),
		]);
	});

	it('keeps a person’s payments and money received apart, and merchants with similar names apart', () => {
		const rows = [
			...monthly(28, MAY_TO_OCT, '650.00', {merchantKey: 'EXPENSE:alex-sam example', personTransfer: true}),
			...monthly(2, MAY_TO_OCT, '20.00', {merchantKey: 'INCOME:alex example'}),
			// Shares the first and last word of a merchant but names no transferred-to person.
			...monthly(5, MAY_TO_OCT, '9.99', {merchantKey: 'EXPENSE:example cloud storage'}),
			...monthly(6, MAY_TO_OCT, '4.99', {merchantKey: 'EXPENSE:example storage'}),
		];

		expect(detectRecurringSeries(rows, TODAY).map(({transactionIds}) => transactionIds.length)).toEqual([
			6, 6, 6, 6,
		]);
	});

	describe('a varying amount', () => {
		const bill = (amounts: string[]) =>
			amounts.map((amount, index) =>
				payment(isoMonth(2026, 1 + index, 5), amount, {category: 'HOUSING_AND_UTILITIES'}),
			);

		it('shows the median of the last six payments with their range and history, and costs the median a month', () => {
			const rows = bill(['300.00', '61.00', '95.00', '48.00', '120.00', '77.00', '82.00']);
			const [series] = detectRecurringSeries(rows, '2026-08-01');

			expect(series).toMatchObject({
				amountKind: 'VARIABLE',
				typicalAmount: '79.50',
				latestAmount: '82.00',
				amountRange: {low: '48.00', high: '120.00'},
				monthlyEquivalent: 7950n,
				flags: [],
			});
			expect(series.recentPayments).toEqual(
				rows.slice(1).map(({date, amountCents}) => ({date, amount: (Number(amountCents) / 100).toFixed(2)})),
			);
		});

		it('flags a bill whose latest payment is clearly above every recent one', () => {
			const rows = bill(['61.00', '95.00', '48.00', '80.00', '77.00', '160.00']);

			expect(detectRecurringSeries(rows, '2026-06-10')).toEqual([
				expect.objectContaining({typicalAmount: '78.50', flags: ['HIGHER_THAN_USUAL']}),
			]);
			// Within the usual spread, or only just above it, is not unusual.
			expect(
				detectRecurringSeries(bill(['61.00', '95.00', '48.00', '80.00', '77.00', '99.00']), '2026-06-10'),
			).toEqual([expect.objectContaining({flags: []})]);
			// Higher pay is not a warning.
			const income = rows.map((row) => ({
				...row,
				merchantKey: 'INCOME:example employer',
				category: 'INCOME' as const,
			}));
			expect(detectRecurringSeries(income, '2026-06-10')).toEqual([expect.objectContaining({flags: []})]);
			// An ended bill is not flagged.
			expect(detectRecurringSeries(rows, '2026-09-01')).toEqual([
				expect.objectContaining({status: 'ENDED', flags: []}),
			]);
		});

		it('keeps a fixed price exact, without a range or history', () => {
			const [series] = detectRecurringSeries(monthly(8, MAY_TO_OCT, '12.99'), TODAY);

			expect(series).toMatchObject({
				amountKind: 'FIXED',
				typicalAmount: '12.99',
				amountRange: null,
				recentPayments: [],
			});
		});

		it('counts this month at what was paid once its payment is in', () => {
			const rows = bill(['61.00', '95.00', '48.00', '120.00', '77.00', '140.00']);

			expect(detectRecurringSeries(rows, '2026-06-20')).toEqual([
				expect.objectContaining({typicalAmount: '86.00', monthlyEquivalent: 14000n}),
			]);
			expect(detectRecurringSeries(rows, '2026-07-02')).toEqual([
				expect.objectContaining({typicalAmount: '86.00', monthlyEquivalent: 8600n}),
			]);
		});
	});
});
