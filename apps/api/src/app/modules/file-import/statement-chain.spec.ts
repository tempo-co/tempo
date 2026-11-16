import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parseFile} from './parsers/parse-file';
import {NormalizedRow, NormalizedStatement, StatementBalance, StatementFormat} from './parsers/parse-result';
import {gapsOutsideCoverage, joinStatements, listsOldestFirst} from './statement-chain';

const row = (bookingDate: string, amount: string, bankReference: string | null = null): NormalizedRow => ({
	bookingDate,
	valueDate: bookingDate,
	transactionDate: null,
	amount,
	creditDebitIndicator: amount.startsWith('-') ? 'DBIT' : 'CRDT',
	currency: 'EUR',
	balanceAfter: null,
	bankReference,
	counterpartyName: 'Example Shop',
	counterpartyIban: null,
	remittanceInformation: null,
	description: null,
	bankTransactionCode: null,
	bankTransactionSubCode: null,
	referenceNumber: null,
});

const balance = (date: string, amount: string): StatementBalance => ({date, amount});

const statement = (
	rows: NormalizedRow[],
	openingBalance: StatementBalance | null = null,
	closingBalance: StatementBalance | null = null,
	format: StatementFormat = 'camt053',
): NormalizedStatement => ({
	format,
	layout: null,
	accountIban: 'NL91ABNA0417164300',
	accountOtherId: null,
	bank: null,
	accountCurrency: 'EUR',
	sequenceNumber: null,
	entriesSkipped: 0,
	openingBalance,
	closingBalance,
	rows,
});

describe('joinStatements', () => {
	it('keeps every row of statements that follow on, and takes the last closing balance', () => {
		const joined = joinStatements([
			statement(
				[row('2026-10-05', '-10.00', 'R1')],
				balance('2026-10-05', '100.00'),
				balance('2026-10-05', '90.00'),
			),
			// The same amount on the next day is another payment.
			statement([row('2026-10-06', '-10.00')], balance('2026-10-06', '90.00'), balance('2026-10-06', '80.00')),
		]);

		expect(joined).toEqual({
			rows: [row('2026-10-05', '-10.00', 'R1'), row('2026-10-06', '-10.00')],
			newestFirst: [row('2026-10-06', '-10.00'), row('2026-10-05', '-10.00', 'R1')],
			repeated: {reference: 0, balance: 0, date: 0},
			gaps: [],
			closingBalance: balance('2026-10-06', '80.00'),
		});
	});

	it('leaves out the rows of the days an earlier statement already holds, and only those', () => {
		const joined = joinStatements([
			statement(
				[row('2026-10-05', '-10.00', 'R1'), row('2026-10-06', '-20.00', 'R2')],
				balance('2026-10-05', '100.00'),
				balance('2026-10-06', '70.00'),
			),
			statement(
				[
					row('2026-10-06', '-20.00', 'R2'),
					// Another payment of the same day, missing from the earlier file.
					row('2026-10-06', '-20.00', 'R4'),
					row('2026-10-07', '-10.00', 'R3'),
				],
				balance('2026-10-06', '90.00'),
				balance('2026-10-07', '40.00'),
			),
		]);

		expect(joined).toEqual({
			rows: [
				row('2026-10-05', '-10.00', 'R1'),
				row('2026-10-06', '-20.00', 'R2'),
				row('2026-10-06', '-20.00', 'R4'),
				row('2026-10-07', '-10.00', 'R3'),
			],
			// Both statements list their rows oldest first; the later statement goes first.
			newestFirst: [
				row('2026-10-07', '-10.00', 'R3'),
				row('2026-10-06', '-20.00', 'R4'),
				row('2026-10-06', '-20.00', 'R2'),
				row('2026-10-05', '-10.00', 'R1'),
			],
			repeated: {reference: 1, balance: 0, date: 0},
			gaps: [],
			closingBalance: balance('2026-10-07', '40.00'),
		});
	});

	it('matches the overlap of statements without references or balances by amount and day', () => {
		const joined = joinStatements([
			statement([row('2026-10-05', '-10.00'), row('2026-10-06', '-20.00')]),
			statement([row('2026-10-06', '-20.00'), row('2026-10-07', '-20.00')]),
		]);

		expect(joined.rows).toEqual([
			row('2026-10-05', '-10.00'),
			row('2026-10-06', '-20.00'),
			row('2026-10-07', '-20.00'),
		]);
		expect(joined.repeated).toEqual({reference: 0, balance: 0, date: 1});
	});

	it("keeps the rows of a statement that opens at the one before's closing balance, also on that one's last day", () => {
		const joined = joinStatements([
			statement([row('2026-10-05', '-10.00')], balance('2026-10-05', '100.00'), balance('2026-10-06', '90.00')),
			statement([row('2026-10-05', '-10.00')], balance('2026-10-06', '90.00'), balance('2026-10-06', '80.00')),
		]);

		expect(joined.rows).toHaveLength(2);
		expect(joined.repeated).toEqual({reference: 0, balance: 0, date: 0});
	});

	it('keeps look-alike rows within one statement', () => {
		const joined = joinStatements([statement([row('2026-10-05', '-4.50'), row('2026-10-05', '-4.50')])]);

		expect(joined.rows).toHaveLength(2);
	});

	it('names a gap where a statement does not open at the closing balance of the one before, with its amount', () => {
		const joined = joinStatements([
			statement([row('2026-10-05', '-10.00')], balance('2026-10-05', '100.00'), balance('2026-10-05', '90.00')),
			statement([row('2026-10-06', '-20.00')], balance('2026-10-06', '90.00'), balance('2026-10-06', '70.00')),
			statement([row('2026-10-07', '-15.00')], balance('2026-10-07', '75.00'), balance('2026-10-07', '60.00')),
			statement([], balance('2026-10-09', '-1140.00'), balance('2026-10-09', '-1140.00')),
		]);

		expect(joined.rows).toHaveLength(3);
		expect(joined.gaps).toEqual([
			{from: '2026-10-06', to: '2026-10-07', amount: '5.00'},
			{from: '2026-10-07', to: '2026-10-09', amount: '-1200.00'},
		]);
		expect(joined.closingBalance).toEqual(balance('2026-10-09', '-1140.00'));
	});

	it('names a gap between statements of one day that do not follow on and share no rows', () => {
		const joined = joinStatements([
			statement(
				[row('2026-10-05', '-10.00', 'R1')],
				balance('2026-10-05', '100.00'),
				balance('2026-10-05', '90.00'),
			),
			statement(
				[row('2026-10-05', '-20.00', 'R3')],
				balance('2026-10-05', '85.00'),
				balance('2026-10-05', '65.00'),
			),
		]);

		expect(joined.rows).toHaveLength(2);
		expect(joined.gaps).toEqual([{from: '2026-10-05', to: '2026-10-05', amount: '-5.00'}]);
	});

	it('names no gap between overlapping statements or statements without balances', () => {
		expect(
			joinStatements([
				statement([row('2026-10-05', '-10.00')]),
				statement([row('2026-10-07', '-15.00')], balance('2026-10-07', '75.00'), null),
				statement([row('2026-10-07', '-15.00'), row('2026-10-08', '-5.00')], balance('2026-10-07', '75.00')),
			]).gaps,
		).toEqual([]);
	});

	it('dates the closing balance on the last booking day of its statement when that is later', () => {
		expect(
			joinStatements([statement([row('2026-10-07', '-15.00')], null, balance('2026-10-06', '60.00'))])
				.closingBalance,
		).toEqual(balance('2026-10-07', '60.00'));
	});
});

describe('gapsOutsideCoverage', () => {
	const gap = {from: '2026-10-05', to: '2026-10-20', amount: '-5.00'};

	it.each([
		{name: 'no coverage', coverage: null, expected: [gap]},
		{name: 'coverage after it', coverage: {from: '2026-10-21', through: '2026-11-10'}, expected: [gap]},
		{name: 'coverage before it', coverage: {from: '2026-09-01', through: '2026-10-04'}, expected: [gap]},
		{
			name: 'coverage over its end',
			coverage: {from: '2026-10-12', through: '2026-11-10'},
			expected: [{...gap, to: '2026-10-11'}],
		},
		{
			name: 'coverage over its start',
			coverage: {from: '2026-09-01', through: '2026-10-07'},
			expected: [{...gap, from: '2026-10-08'}],
		},
		{
			name: 'coverage inside it',
			coverage: {from: '2026-10-10', through: '2026-10-12'},
			expected: [
				{...gap, to: '2026-10-09'},
				{...gap, from: '2026-10-13'},
			],
		},
		{name: 'coverage over all of it', coverage: {from: '2026-10-05', through: '2026-10-20'}, expected: []},
	])('keeps the days of a gap that bank sync does not cover, with $name', ({coverage, expected}) => {
		expect(gapsOutsideCoverage([gap], coverage)).toEqual(expected);
	});
});

describe('listsOldestFirst', () => {
	const withBalance = (bookingDate: string, amount: string, balanceAfter: string) => ({
		...row(bookingDate, amount),
		balanceAfter,
	});

	it.each([
		{
			name: 'dates that mostly rise',
			rows: [
				row('2026-03-01', '-1.00'),
				row('2026-03-03', '-2.00'),
				row('2026-03-02', '-3.00'),
				row('2026-03-04', '-4.00'),
			],
			expected: true,
		},
		{
			name: 'dates that mostly fall',
			rows: [
				row('2026-03-04', '-1.00'),
				row('2026-03-02', '-2.00'),
				row('2026-03-03', '-3.00'),
				row('2026-03-01', '-4.00'),
			],
			expected: false,
		},
		{
			name: 'one day whose balances follow the rows',
			rows: [withBalance('2026-03-02', '-1.00', '99.00'), withBalance('2026-03-02', '5.00', '104.00')],
			expected: true,
		},
		{
			name: 'one day whose balances run back up the rows',
			rows: [withBalance('2026-03-02', '5.00', '104.00'), withBalance('2026-03-02', '-1.00', '99.00')],
			expected: false,
		},
		{
			name: 'dates that rise as often as they fall, and balances that follow the rows',
			rows: [
				withBalance('2026-03-01', '-1.00', '99.00'),
				withBalance('2026-03-02', '-2.00', '97.00'),
				withBalance('2026-03-01', '-3.00', '94.00'),
			],
			expected: true,
		},
		{
			name: 'one day without balances',
			rows: [row('2026-03-02', '-1.00'), row('2026-03-02', '-2.00')],
			expected: false,
		},
		{
			name: 'one day of a payment and its refund, listed newest first',
			rows: [withBalance('2026-03-02', '10.00', '100.00'), withBalance('2026-03-02', '-10.00', '90.00')],
			expected: false,
		},
		{
			name: 'one day of zero amounts',
			rows: [withBalance('2026-03-02', '0.00', '100.00'), withBalance('2026-03-02', '0.00', '100.00')],
			expected: false,
		},
	])('reads $name as oldest first: $expected', ({rows, expected}) => {
		expect(listsOldestFirst(rows)).toBe(expected);
	});

	it.each([
		{name: 'one day without balances', rows: [row('2026-03-02', '-1.00'), row('2026-03-02', '-2.00')]},
		{
			name: 'one day of a payment and its refund',
			rows: [withBalance('2026-03-02', '10.00', '100.00'), withBalance('2026-03-02', '-10.00', '90.00')],
		},
	])('leaves $name to the order the format is known to list in', ({rows}) => {
		expect(listsOldestFirst(rows, true)).toBe(true);
		expect(listsOldestFirst(rows, false)).toBe(false);
	});

	it('lets dates and balances outweigh the order the format is known to list in', () => {
		const newestFirst = [withBalance('2026-03-02', '5.00', '104.00'), withBalance('2026-03-02', '-1.00', '99.00')];
		expect(listsOldestFirst(newestFirst, true)).toBe(false);
		expect(listsOldestFirst([row('2026-03-03', '-1.00'), row('2026-03-02', '-2.00')], true)).toBe(false);
		// Dates that fall decide before balances that follow the rows, and both before the format.
		const datesAgainstBalances = [
			withBalance('2026-03-03', '-1.00', '99.00'),
			withBalance('2026-03-02', '-2.00', '97.00'),
		];
		expect(listsOldestFirst(datesAgainstBalances, true)).toBe(false);
	});
});

describe('joinStatements newest-first listing', () => {
	it('turns around each statement that lists its rows oldest first, and only that one', () => {
		const [first, second, third, fourth] = [
			row('2026-03-01', '-1.00'),
			row('2026-03-02', '-2.00'),
			row('2026-03-04', '-3.00'),
			row('2026-03-03', '-4.00'),
		];
		const joined = joinStatements([statement([first, second]), statement([third, fourth])]);
		expect(joined.rows).toEqual([first, second, third, fourth]);
		expect(joined.newestFirst).toEqual([third, fourth, second, first]);
	});

	it('lists a day split over two statements newest first as a whole', () => {
		const rows = [
			{...row('2026-03-02', '-1.00'), balanceAfter: '99.00'},
			{...row('2026-03-02', '-2.00'), balanceAfter: '97.00'},
			{...row('2026-03-02', '-3.00'), balanceAfter: '94.00'},
			{...row('2026-03-02', '-4.00'), balanceAfter: '90.00'},
		];
		const joined = joinStatements([
			statement(rows.slice(0, 2), balance('2026-03-01', '100.00'), balance('2026-03-02', '97.00')),
			statement(rows.slice(2), balance('2026-03-02', '97.00'), balance('2026-03-02', '90.00')),
		]);
		expect(joined.newestFirst).toEqual(rows.toReversed());
	});

	it.each(['revolutCsv', 'revolutXlsx', 'mt940', 'abnAmroTxt'] as const)(
		'turns around a %s statement whose dates and balances leave its order open',
		(format) => {
			const rows = [row('2026-03-02', '10.00'), row('2026-03-02', '-10.00')];
			expect(joinStatements([statement(rows, null, null, format)]).newestFirst).toEqual(rows.toReversed());
		},
	);

	it.each(['camt053', 'ofx', 'csv'] as const)(
		'keeps the order of a %s statement whose rows leave it open',
		(format) => {
			const rows = [row('2026-03-02', '10.00'), row('2026-03-02', '-10.00')];
			expect(joinStatements([statement(rows, null, null, format)]).newestFirst).toEqual(rows);
		},
	);

	it('lists a Revolut day of two rows that cancel out newest first', () => {
		const file = readFileSync(
			join(__dirname, '../../../../test/fixtures/file-import/revolut-one-day-cancelling-synthetic.csv'),
		);
		const [parsed] = parseFile(file).statements;
		expect(parsed.format).toBe('revolutCsv');
		expect(joinStatements([parsed]).newestFirst.map(({amount}) => amount)).toEqual(['-10.00', '10.00']);
	});
});
