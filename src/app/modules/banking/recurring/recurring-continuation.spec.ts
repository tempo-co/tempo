import {findContinuationPairs} from './recurring-continuation';
import {type RecurringCandidate, atDate, detectUndatedRecurringSeries} from './recurring-series-detection';

let nextId = 0;

function payment(date: string, overrides: Partial<RecurringCandidate> = {}): RecurringCandidate {
	return {
		id: `row-${String(++nextId).padStart(4, '0')}`,
		bankAccountId: 'account-1',
		date,
		merchantKey: 'EXPENSE:example motion',
		currency: 'EUR',
		amountCents: 2400n,
		baseAmountCents: 2400n,
		name: 'Example Motion Ltd',
		category: 'SUBSCRIPTIONS',
		...overrides,
	};
}

const OLDER_DATES = ['2036-01-11', '2036-02-11', '2036-03-11'];
const NEWER_DATES = ['2036-07-08', '2036-08-09', '2036-09-10'];

/** A plan paid under a company name, then a few months later under its branch name from another account. */
function history(newer: Partial<RecurringCandidate> = {}, newerDates = NEWER_DATES): RecurringCandidate[] {
	return [
		...OLDER_DATES.map((date) => payment(date)),
		...newerDates.map((date) =>
			payment(date, {
				bankAccountId: 'account-2',
				merchantKey: 'EXPENSE:example motion exampletown',
				name: 'Example Motion Exampletown',
				amountCents: 2500n,
				baseAmountCents: 2500n,
				...newer,
			}),
		),
	];
}

function rent(count = 1): RecurringCandidate[] {
	return [...OLDER_DATES, ...['2036-04-11', '2036-05-11', '2036-06-11'].slice(0, count)].map((date, index) =>
		payment(date, {
			merchantKey: index < 3 ? 'EXPENSE:alex-jo example' : 'EXPENSE:alex example',
			name: index < 3 ? 'Transfer to ALEX-JO EXAMPLE' : 'Alex Example',
			personTransfer: index < 3,
			category: 'HOUSING_AND_UTILITIES',
			amountCents: 48000n,
			baseAmountCents: 48000n,
		}),
	);
}

function pairs(rows: RecurringCandidate[]) {
	const series = detectUndatedRecurringSeries(rows);
	return {series, pairs: findContinuationPairs(series, new Map(rows.map((row) => [row.id, row])))};
}

const ids = (rows: readonly RecurringCandidate[]) => rows.map(({id}) => id);

describe('findContinuationPairs', () => {
	it('pairs successive histories whose names, price and rhythm continue, leaving both histories unchanged', () => {
		const rows = history();
		const before = structuredClone(rows);
		for (const input of [rows, [...rows].reverse()]) {
			const result = pairs(input);
			expect(result.series).toHaveLength(2);
			const [older, newer] = [...result.series].sort((a, b) => a.firstDate.localeCompare(b.firstDate));
			expect(result.pairs).toEqual([
				{
					older,
					newer,
					joined: expect.objectContaining({
						name: newer.name,
						cadence: newer.cadence,
						amountKind: 'FIXED',
						typicalAmount: newer.typicalAmount,
						usualMonthlyEquivalent: newer.usualMonthlyEquivalent,
						firstDate: older.firstDate,
						lastDate: newer.lastDate,
						nextExpectedDate: newer.nextExpectedDate,
						transactionIds: ids(rows),
						restartTransactionIds: [rows[3].id],
					}),
				},
			]);
		}
		expect(rows).toEqual(before);
	});

	it.each([1, 2])('continues established monthly rent at its settled price with %i new-name payments', (count) => {
		const established = rent(count);
		const rows = [
			payment('2035-12-11', {
				...established[0],
				id: 'earlier-price',
				date: '2035-12-11',
				amountCents: count === 1 ? 42000n : 54000n,
				baseAmountCents: count === 1 ? 42000n : 54000n,
			}),
			...established,
		];
		const before = structuredClone(rows);
		for (const input of [rows, [...rows].reverse(), [...rows.slice(2), ...rows.slice(0, 2)]]) {
			const result = pairs(input);
			expect(result.series).toHaveLength(1);
			expect(result.pairs).toEqual([
				expect.objectContaining({
					older: expect.objectContaining({transactionIds: ids(rows.slice(0, 4))}),
					newer: expect.objectContaining({
						transactionIds: ids(rows.slice(4)),
						cadence: 'MONTHLY',
						typicalAmount: '480.00',
					}),
					joined: expect.objectContaining({
						transactionIds: ids(rows),
						name: 'Alex Example',
						cadence: 'MONTHLY',
						amountKind: 'FIXED',
						typicalAmount: '480.00',
						latestAmount: '480.00',
						usualMonthlyEquivalent: 48000n,
						nextExpectedDate: count === 1 ? '2036-05-11' : '2036-06-11',
						restartTransactionIds: [],
					}),
				}),
			]);
		}
		expect(rows).toEqual(before);
	});

	it('treats a legacy transfer prefix as formatting rather than an omitted name component', () => {
		const rows = rent().map((row, index) => ({
			...row,
			merchantKey: index < 3 ? 'EXPENSE:transfer to alex-jo example' : 'EXPENSE:alex-jo example',
		}));
		expect(pairs(rows).pairs).toEqual([]);
	});

	it('continues across a supported skipped monthly slot', () => {
		const rows = rent().map((row, index) => (index < 3 ? row : {...row, date: '2036-05-11'}));
		expect(pairs(rows).pairs).toEqual([
			expect.objectContaining({
				joined: expect.objectContaining({
					transactionIds: ids(rows),
					restartTransactionIds: [rows[3].id],
					nextExpectedDate: '2036-06-11',
				}),
			}),
		]);
	});

	it('separates a misaligned payment from a long monthly history', () => {
		const source = rent();
		const rows = ['2036-01-11', '2036-02-11', '2036-03-11', '2036-04-11', '2036-05-11', '2036-06-11'].map(
			(date, index) => ({...source[0], date, id: `long-${index}`}),
		);
		rows.push({...source[3], date: '2036-07-25'});
		expect(pairs(rows).pairs).toEqual([]);
	});

	it('continues a month-end bill through leap February using the established calendar', () => {
		const rows = rent().map((row, index) => ({
			...row,
			date: ['2035-11-30', '2035-12-31', '2036-01-31', '2036-02-29'][index],
		}));
		const [pair] = pairs(rows).pairs;
		expect(pair.joined).toMatchObject({
			transactionIds: ids(rows),
			nextExpectedDate: '2036-03-31',
			restartTransactionIds: [],
		});
		expect(atDate(pair.joined, '2036-04-05')).toMatchObject({
			status: 'ACTIVE',
			flags: ['LATE'],
			monthlyEquivalent: 48000n,
		});
		expect(atDate(pair.joined, '2036-04-06')).toMatchObject({status: 'ENDED', flags: []});
	});

	it('requires an established predecessor for a short newer bill', () => {
		const rows = rent(2).slice(3);
		expect(pairs(rows)).toEqual({series: [], pairs: []});
	});

	it('continues independently qualified monthly person histories', () => {
		const rows = rent(3);
		expect(pairs(rows).series).toHaveLength(2);
		expect(pairs(rows).pairs).toEqual([
			expect.objectContaining({joined: expect.objectContaining({transactionIds: ids(rows), cadence: 'MONTHLY'})}),
		]);
	});

	it('separates independently qualified person histories across accounts', () => {
		const rows = rent(3).map((row, index) => (index < 3 ? row : {...row, bankAccountId: 'account-2'}));
		expect(pairs(rows).series).toHaveLength(2);
		expect(pairs(rows).pairs).toEqual([]);
	});

	it('separates a quarterly person history from a monthly name lookalike', () => {
		const original = rent();
		const rows = ['2035-01-11', '2035-04-11', '2035-07-11', '2035-10-11', '2036-01-11'].map((date, index) => ({
			...original[0],
			id: `quarter-${index}`,
			date,
		}));
		rows.push({...original[3], date: '2036-02-11'});
		expect(pairs(rows).series[0].cadence).toBe('QUARTERLY');
		expect(pairs(rows).pairs).toEqual([]);
	});

	it('continues a known fixed monthly bill named only by counterparties', () => {
		const rows = rent().map((row) => ({...row, personTransfer: false}));
		expect(pairs(rows).pairs).toEqual([
			expect.objectContaining({joined: expect.objectContaining({transactionIds: ids(rows)})}),
		]);
	});

	it.each([
		['longer newer name', 'alex example', 'alex-jo example'],
		['omitted whole middle word', 'alex jo example', 'alex example'],
		['omitted surname word', 'alex van example', 'alex example'],
	] as const)('continues rent with a %s', (_label, oldKey, newKey) => {
		const rows = rent(2).map((row, index) => ({...row, merchantKey: `EXPENSE:${index < 3 ? oldKey : newKey}`}));
		for (const input of [rows, [...rows].reverse()])
			expect(pairs(input).pairs).toEqual([
				expect.objectContaining({joined: expect.objectContaining({transactionIds: ids(rows)})}),
			]);
	});

	it('continues only the fixed bill amid unrelated activity under both raw names', () => {
		const rows = rent();
		const extras = ['2036-01-18', '2036-02-20', '2036-03-24', '2036-04-03', '2036-04-15'].map((date, index) =>
			payment(date, {
				...rows[index % rows.length],
				id: `extra-${index}`,
				date,
				amountCents: BigInt(1300 + index * 701),
				category: index % 2 ? 'TRANSFER_OUT' : 'SHOPPING',
			}),
		);
		for (const input of [[...rows, ...extras], [...extras, ...rows].reverse()])
			expect(pairs(input).pairs).toEqual([
				expect.objectContaining({joined: expect.objectContaining({transactionIds: ids(rows)})}),
			]);
	});

	it.each<[string, (rows: RecurringCandidate[]) => RecurringCandidate[]]>([
		[
			'conflicting full middle names',
			(rows) =>
				rows.map((row, index) =>
					index < 3 ? row : {...row, merchantKey: 'EXPENSE:alex-sam example', name: 'Alex-Sam Example'},
				),
		],
		[
			'a different last name',
			(rows) =>
				rows.map((row, index) =>
					index < 3 ? row : {...row, merchantKey: 'EXPENSE:alex other', name: 'Alex Other'},
				),
		],
		[
			'an omitted first name',
			(rows) => rows.map((row, index) => (index < 3 ? row : {...row, merchantKey: 'EXPENSE:jo example'})),
		],
		[
			'an omitted final surname',
			(rows) => rows.map((row, index) => (index < 3 ? row : {...row, merchantKey: 'EXPENSE:alex jo'})),
		],
		[
			'an edit-distance lookalike',
			(rows) =>
				rows.map((row, index) =>
					index < 3 ? row : {...row, merchantKey: 'EXPENSE:alec example', name: 'Alec Example'},
				),
		],
		['an unknown purpose', (rows) => rows.map((row) => ({...row, category: null}))],
		[
			'a one-word name',
			(rows) => rows.map((row, index) => (index < 3 ? row : {...row, merchantKey: 'EXPENSE:example'})),
		],
		['ordinary retail purchases', (rows) => rows.map((row) => ({...row, category: 'SHOPPING'}))],
		[
			'a different purpose',
			(rows) => rows.map((row, index) => (index < 3 ? row : {...row, category: 'EDUCATION'})),
		],
		['reimbursements', (rows) => rows.map((row) => ({...row, category: 'TRANSFER_OUT'}))],
		[
			'varying person transfers',
			(rows) => rows.map((row, index) => (index < 3 ? row : {...row, amountCents: 47900n})),
		],
		[
			'a varying established price',
			(rows) => rows.map((row, index) => (index === 1 ? {...row, amountCents: 47900n} : row)),
		],
		[
			'a different bank account',
			(rows) => rows.map((row, index) => (index < 3 ? row : {...row, bankAccountId: 'account-2'})),
		],
		['a different currency', (rows) => rows.map((row, index) => (index < 3 ? row : {...row, currency: 'USD'}))],
		[
			'an opposite direction',
			(rows) => rows.map((row, index) => (index < 3 ? row : {...row, merchantKey: 'INCOME:alex example'})),
		],
		[
			'a payment outside the next billing slot',
			(rows) => rows.map((row, index) => (index < 3 ? row : {...row, date: '2036-04-25'})),
		],
		['a concurrent obligation', (rows) => [...rows, {...rows[0], id: 'concurrent', date: '2036-04-11'}]],
		['annual transfers', (rows) => rows.map((row, index) => ({...row, date: `${2033 + index}-01-11`}))],
	])('separates person histories with %s', (_label, changed) => {
		const rows = changed(rent());
		for (const input of [rows, [...rows].reverse()]) expect(pairs(input).pairs).toEqual([]);
	});

	it.each([
		[1, 1],
		[1, 2],
		[2, 1],
		[2, 2],
	])('leaves %i-payment and %i-payment competing successors unresolved', (count, competingCount) => {
		const rows = rent(count);
		const competing = rent(competingCount)
			.slice(3)
			.map((row, index) => ({
				...row,
				id: `competing-${index}`,
				merchantKey: 'EXPENSE:alex jo sam example',
				name: 'Alex Jo Sam Example',
			}));
		for (const input of [[...rows, ...competing], [...competing, ...rows].reverse()])
			expect(pairs(input).pairs).toEqual([]);
	});

	it('leaves competing established predecessors unresolved', () => {
		const rows = rent();
		const competing = rows.slice(0, 3).map((row, index) => ({
			...row,
			id: `predecessor-${index}`,
			merchantKey: 'EXPENSE:alex-sam example',
			name: 'Transfer to Alex-Sam Example',
		}));
		for (const input of [[...rows, ...competing], [...competing, ...rows].reverse()])
			expect(pairs(input).pairs).toEqual([]);
	});

	it('leaves a changing successor price outside a fixed continuation', () => {
		const rows = rent(2).map((row, index) => (index === 4 ? {...row, amountCents: 47900n} : row));
		expect(pairs(rows).pairs).toEqual([]);
	});

	it('separates company continuations with conflicting available recipient identifiers', () => {
		const rows = history().map((row, index) => ({
			...row,
			recipientIbans: [index < 3 ? 'NL91ABNA0417164300' : 'DE89370400440532013000'],
		}));
		expect(pairs(rows).pairs).toEqual([]);
	});

	it('separates available conflicting recipient identifiers', () => {
		const rows = rent().map((row, index) => ({
			...row,
			recipientIbans: [index < 3 ? 'NL91ABNA0417164300' : 'DE89370400440532013000'],
		}));
		expect(pairs(rows).pairs).toEqual([]);
	});

	it('pairs histories when the earlier name is the longer one', () => {
		const rows = history({merchantKey: 'EXPENSE:example motion', name: 'Example Motion Ltd'}).map((row, index) =>
			index < 3
				? {...row, merchantKey: 'EXPENSE:example motion exampletown', name: 'Example Motion Exampletown'}
				: row,
		);
		expect(pairs(rows).pairs).toEqual([
			expect.objectContaining({
				joined: expect.objectContaining({transactionIds: ids(rows), name: 'Example Motion Ltd'}),
			}),
		]);
	});

	it('pairs histories within one bank account', () => {
		const rows = history({bankAccountId: 'account-1'});
		expect(pairs(rows).pairs).toEqual([
			expect.objectContaining({joined: expect.objectContaining({transactionIds: ids(rows)})}),
		]);
	});

	it('keeps a late manual payment late and the billing day where it was', () => {
		const rows = history({}, ['2036-05-11', '2036-06-05', '2036-07-05', '2036-08-05']).map((row, index) =>
			index < 3 ? {...row, date: ['2036-01-05', '2036-02-05', '2036-03-05'][index]} : row,
		);
		const [pair] = pairs(rows).pairs;
		expect(atDate(pair.joined, '2036-09-07')).toMatchObject({
			nextExpectedDate: '2036-09-05',
			status: 'ACTIVE',
			flags: ['LATE'],
			lastDate: '2036-08-05',
		});
		expect(pair.joined.restartTransactionIds).toContain(rows[3].id);
	});

	it.each<[string, () => RecurringCandidate[]]>([
		['different purposes', () => history({category: 'EDUCATION'})],
		['unknown purpose', () => history().map((row) => ({...row, category: null}))],
		['different currencies', () => history({currency: 'USD'})],
		['opposite directions', () => history({merchantKey: 'INCOME:example motion exampletown', category: 'INCOME'})],
		['an unsupported price jump', () => history({amountCents: 7100n, baseAmountCents: 7100n})],
		[
			'variable pricing',
			() =>
				history().map((row, index) =>
					// A variable bill whose median sits within the fixed price's tolerance.
					index < 3 ? row : {...row, amountCents: [1100n, 2500n, 5900n][index - 3], baseAmountCents: null},
				),
		],
		['ordinary retail', () => history().map((row) => ({...row, category: 'SHOPPING'}))],
		['person transfers', () => history().map((row) => ({...row, category: 'TRANSFER_OUT'}))],
		[
			'bank-described person transfers',
			() => history().map((row) => ({...row, personTransfer: true, category: 'HOUSING_AND_UTILITIES'})),
		],
		['overlapping plans', () => history({}, ['2036-02-11', '2036-03-11', '2036-04-11'])],
		['staggered simultaneous billing', () => history({}, ['2036-01-25', '2036-02-25', '2036-03-25'])],
		['different cadences', () => history({}, ['2036-07-08', '2036-07-15', '2036-07-22'])],
		[
			'a shared prefix inside a longer word',
			() =>
				history({
					merchantKey: 'EXPENSE:example motionworks exampletown',
					name: 'Example Motionworks Exampletown',
				}),
		],
		[
			'the exact same name',
			() => history({merchantKey: 'EXPENSE:example motion other', name: 'Example Motion Ltd'}),
		],
		[
			'two plausible successors',
			() => [
				...history(),
				...NEWER_DATES.map((date) =>
					payment(date, {
						bankAccountId: 'account-3',
						merchantKey: 'EXPENSE:example motion otherplace',
						name: 'Example Motion Otherplace',
					}),
				),
			],
		],
		[
			'two plausible predecessors',
			() => [
				...history(),
				...OLDER_DATES.map((date) =>
					payment(date, {
						bankAccountId: 'account-3',
						merchantKey: 'EXPENSE:example motion bv',
						name: 'Example Motion',
					}),
				),
			],
		],
	])('does not pair histories with %s', (_label, rows) => {
		expect(pairs(rows()).pairs).toEqual([]);
	});

	it('does not pair histories whose union the detector would not keep whole', () => {
		// Two yearly histories a decade apart: each is regular, the union is not.
		const rows = history({}, ['2042-07-08', '2043-07-09'])
			.slice(1)
			.map((row, index) => (index < 2 ? {...row, date: ['2032-01-11', '2033-01-11'][index]} : row));
		expect(pairs(rows).series.map(({cadence}) => cadence)).toEqual(['YEARLY', 'YEARLY']);
		expect(pairs(rows).pairs).toEqual([]);
	});
});
