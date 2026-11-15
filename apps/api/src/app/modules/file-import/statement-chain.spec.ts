import {NormalizedRow, NormalizedStatement, StatementBalance} from './parsers/parse-result';
import {joinStatements} from './statement-chain';

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
): NormalizedStatement => ({
	format: 'camt053',
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
