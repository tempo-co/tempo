import {EXAMPLE_IBAN} from '../../../../../test/fixtures/statement-file.fixture';
import {MAX_ROWS_PER_DROP} from '../parsers/parse-limits';
import {ParseRefusal} from '../parsers/parse-result';
import {validateParseOutput} from './validate-parse-output';

const row = (overrides: Record<string, unknown> = {}) => ({
	bookingDate: '2026-03-02',
	valueDate: '2026-03-01',
	transactionDate: null,
	amount: '-12.50',
	creditDebitIndicator: 'DBIT',
	currency: 'EUR',
	balanceAfter: '987.50',
	bankReference: 'EXAMPLE-1',
	counterpartyName: 'Example Shop',
	counterpartyIban: 'nl44 rabo 0123 4567 89',
	remittanceInformation: null,
	description: 'Example card payment',
	bankTransactionCode: 'CCRD',
	bankTransactionSubCode: 'POSD',
	referenceNumber: null,
	...overrides,
});

const output = (rows: unknown[], statement: Record<string, unknown> = {}) => ({
	ok: true,
	files: 1,
	formats: ['camt053'],
	statements: [
		{
			format: 'camt053',
			accountIban: EXAMPLE_IBAN,
			accountOtherId: null,
			bank: null,
			accountCurrency: 'EUR',
			sequenceNumber: '1',
			entriesSkipped: 0,
			rows,
			...statement,
		},
	],
});

describe('validateParseOutput', () => {
	it('normalizes IBANs, strips control characters and caps text to the column limits', () => {
		const result = validateParseOutput(
			output([
				row({
					counterpartyName: `Example\u0000Shop\u001b[31m ${'x'.repeat(300)}`,
					description: '\n\tExample card payment\r\n',
				}),
				row({counterpartyIban: 'NL00NOTANIBAN', amount: '0.00'}),
			]),
		);

		expect(result).toEqual({ok: true, result: expect.anything()});
		const [first, second] = (result as {result: {statements: {rows: Record<string, unknown>[]}[]}}).result
			.statements[0].rows;
		expect(first.counterpartyIban).toBe('NL44RABO0123456789');
		expect(first.counterpartyName).toBe(`Example Shop [31m ${'x'.repeat(300)}`.slice(0, 255));
		expect(first.description).toBe('Example card payment');
		expect(second.counterpartyIban).toBeNull();
	});

	it('accepts a statement that names no account when it names a known bank', () => {
		const result = validateParseOutput({
			...output([], {format: 'revolutCsv', accountIban: null, bank: 'Revolut'}),
			formats: ['revolutCsv'],
		});

		expect(result).toMatchObject({
			ok: true,
			result: {formats: ['revolutCsv'], statements: [{accountIban: null, accountOtherId: null, bank: 'Revolut'}]},
		});
	});

	it('passes a refusal code the child may use', () => {
		expect(validateParseOutput({ok: false, code: 'archive_too_large'})).toEqual({
			ok: false,
			code: 'archive_too_large',
		});
	});

	it.each([
		{name: 'not an object', value: 'rows'},
		{name: 'an unknown file format', value: {...output([]), formats: ['ofx']}},
		{name: 'an unknown statement format', value: output([], {format: 'ofx'})},
		{name: 'a statement in a format none of the files has', value: output([], {format: 'mt940'})},
		{name: 'an unknown bank', value: output([], {accountIban: null, bank: 'Example Bank'})},
		{name: 'a bank next to an IBAN', value: output([], {bank: 'Revolut'})},
		{name: 'a refusal code the child may not use', value: {ok: false, code: 'synced_account_not_supported_yet'}},
		{name: 'an amount as a number', value: output([row({amount: -12.5})])},
		{name: 'an amount with an exponent', value: output([row({amount: '-1e3'})])},
		{name: 'a sign against the direction', value: output([row({amount: '12.50'})])},
		{name: 'a date that does not exist', value: output([row({bookingDate: '2026-02-30'})])},
		{name: 'a currency that is not a code', value: output([row({currency: 'eur'})])},
		{name: 'an account IBAN that fails its checksum', value: output([], {accountIban: 'NL91ABNA0417164301'})},
		{
			name: 'an account id longer than an account number',
			value: output([], {accountIban: null, accountOtherId: 'x'.repeat(35)}),
		},
		{name: 'a statement without an account', value: output([], {accountIban: null, accountOtherId: null})},
	])('refuses $name as parse_failed', ({value}) => {
		expect(() => validateParseOutput(value)).toThrow(new ParseRefusal('parse_failed'));
	});

	it('refuses more rows than one drop may hold', () => {
		const rows = Array.from({length: MAX_ROWS_PER_DROP + 1}, () => row());

		expect(() => validateParseOutput(output(rows))).toThrow(new ParseRefusal('too_many_rows'));
	});
});
