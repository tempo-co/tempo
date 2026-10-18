import {type RecurringCandidate, detectRecurringSeries} from './recurring-series-detection';

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

describe('detectRecurringSeries', () => {
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

	it('needs three monthly payments', () => {
		expect(detectRecurringSeries(monthly(3, ['2026-08', '2026-09'], '9.99'), TODAY)).toEqual([]);
	});

	it('detects weekly and quarterly payments with their monthly equivalents', () => {
		const weekly = ['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17'].map((date) =>
			payment(date, '6.00', {merchantKey: 'EXPENSE:example lessons'}),
		);
		const quarterly = ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map((date) =>
			payment(date, '90.00', {merchantKey: 'EXPENSE:example water'}),
		);

		const series = detectRecurringSeries([...weekly, ...quarterly], TODAY);

		expect(series).toEqual(
			expect.arrayContaining([
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
		const people = dates.map((date) => payment(date, '120.00', {merchantKey: 'EXPENSE:transfer to alex example'}));
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

	it('keeps a price step in one series and flags it', () => {
		const rows = [...monthly(8, MAY_TO_OCT.slice(0, 5), '10.00'), payment('2026-10-08', '11.50')];

		const [series, ...rest] = detectRecurringSeries(rows, TODAY);

		expect(rest).toHaveLength(0);
		expect(series).toMatchObject({
			typicalAmount: '10.00',
			latestAmount: '11.50',
			monthlyEquivalent: 1150n,
			flags: ['PRICE_INCREASED'],
		});
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
				typicalAmount: '30.00',
				monthlyEquivalent: 3000n,
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
				monthlyEquivalent: 8300n,
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
			merchantKey: 'EXPENSE:transfer to alex-sam example',
		}));
		const counterpartyFriend = [payment('2025-07-02', '30.00'), payment('2026-07-01', '30.00')].map((row) => ({
			...row,
			merchantKey: 'EXPENSE:sam other',
			category: 'TRANSFER_OUT',
		}));

		// A named person seen elsewhere as a transfer, now under a plain counterparty name.
		const knownPerson = [payment('2025-06-03', '25.00'), payment('2026-06-02', '25.00')].map((row) => ({
			...row,
			merchantKey: 'EXPENSE:jo sample',
		}));
		const knownPersonTransfer = {
			...payment('2026-01-15', '5.00'),
			merchantKey: 'EXPENSE:transfer to jo sample',
		};
		// Two transfers a year apart beside one uncategorised payment to the same payee.
		const mixed = [
			{...payment('2025-05-10', '40.00'), category: 'TRANSFER_OUT'},
			{...payment('2026-01-20', '12.00'), category: null},
			{...payment('2026-05-09', '40.00'), category: 'TRANSFER_OUT'},
		].map((row) => ({...row, merchantKey: 'EXPENSE:pat mixed'}));

		const rows = [...insurer, ...friend, ...counterpartyFriend, ...knownPerson, knownPersonTransfer, ...mixed];
		expect(detectRecurringSeries(rows, TODAY)).toEqual([
			expect.objectContaining({cadence: 'YEARLY', transactionIds: insurer.map(({id}) => id)}),
		]);
	});

	it('still finds a monthly transfer to a person', () => {
		const rows = monthly(28, MAY_TO_OCT.slice(0, 5), '650.00', {
			merchantKey: 'EXPENSE:transfer to alex-sam example',
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

	it('groups a person named in a transfer description with their later counterparty name', () => {
		const older = monthly(28, ['2026-05', '2026-06', '2026-07', '2026-08'], '650.00', {
			merchantKey: 'EXPENSE:transfer to alex-sam exämple',
			name: 'Transfer to ALEX-SAM EXAMPLE',
		});
		const newer = monthly(28, ['2026-09'], '650.00', {merchantKey: 'EXPENSE:alex example', name: 'Alex Example'});

		expect(detectRecurringSeries([...older, ...newer], TODAY)).toEqual([
			expect.objectContaining({
				name: 'Alex Example',
				status: 'ACTIVE',
				transactionIds: [...older, ...newer].map(({id}) => id),
			}),
		]);
	});

	it('groups transfers from a person the same way', () => {
		const older = monthly(1, ['2026-05', '2026-06', '2026-07'], '40.00', {
			merchantKey: 'INCOME:transfer from alex-sam example',
			name: 'Transfer from ALEX-SAM EXAMPLE',
		});
		const newer = monthly(1, ['2026-08', '2026-09', '2026-10'], '40.00', {
			merchantKey: 'INCOME:alex example',
			name: 'Alex Example',
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
			...monthly(28, MAY_TO_OCT, '650.00', {merchantKey: 'EXPENSE:transfer to alex-sam example'}),
			...monthly(2, MAY_TO_OCT, '20.00', {merchantKey: 'INCOME:alex example'}),
			// Shares the first and last word of a merchant but names no transferred-to person.
			...monthly(5, MAY_TO_OCT, '9.99', {merchantKey: 'EXPENSE:example cloud storage'}),
			...monthly(6, MAY_TO_OCT, '4.99', {merchantKey: 'EXPENSE:example storage'}),
		];

		expect(detectRecurringSeries(rows, TODAY).map(({transactionIds}) => transactionIds.length)).toEqual([
			6, 6, 6, 6,
		]);
	});
});
