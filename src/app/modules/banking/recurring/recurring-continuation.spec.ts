import {findContinuationPairs} from './recurring-continuation';
import {type RecurringCandidate, detectRecurringSeries} from './recurring-series-detection';

const AS_OF = '2036-11-20';
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

function pairs(rows: RecurringCandidate[], asOf = AS_OF) {
	const series = detectRecurringSeries(rows, asOf);
	return {series, pairs: findContinuationPairs(series, new Map(rows.map((row) => [row.id, row])), asOf)};
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
						monthlyEquivalent: newer.monthlyEquivalent,
						firstDate: older.firstDate,
						lastDate: newer.lastDate,
						nextExpectedDate: newer.nextExpectedDate,
						status: 'ENDED',
						transactionIds: ids(rows),
						restartTransactionIds: [rows[3].id],
					}),
				},
			]);
		}
		expect(rows).toEqual(before);
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
		const [pair] = pairs(rows, '2036-09-07').pairs;
		expect(pair.joined).toMatchObject({
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
		expect(pairs(rows, '2043-08-01').series.map(({cadence}) => cadence)).toEqual(['YEARLY', 'YEARLY']);
		expect(pairs(rows, '2043-08-01').pairs).toEqual([]);
	});
});
