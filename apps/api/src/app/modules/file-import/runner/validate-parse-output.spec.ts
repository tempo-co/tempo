import {EXAMPLE_IBAN} from '../../../../../test/fixtures/statement-file.fixture';
import {CsvLayout} from '../parsers/csv-layout';
import {MAX_ROWS_PER_DROP} from '../parsers/parse-limits';
import {ParseRefusal} from '../parsers/parse-result';
import {validateParseOutput, validateSampleOutput} from './validate-parse-output';

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
	layouts: [],
	statements: [
		{
			format: 'camt053',
			layout: null,
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

	it("accepts a statement that names no account under the bank of the owner's layout it was read with", () => {
		const owned = {id: 'learned-example', bank: 'Example Bank'} as CsvLayout;
		const statement = {format: 'csv', layout: 'learned-example', accountIban: null, bank: 'Example Bank'};
		const value = {...output([], statement), formats: ['csv'], layouts: ['learned-example']};

		expect(validateParseOutput(value, [owned])).toMatchObject({ok: true, result: {statements: [statement]}});
		expect(() => validateParseOutput(value, [{...owned, bank: 'Other Bank'}])).toThrow(
			new ParseRefusal('parse_failed'),
		);
		expect(() => validateParseOutput(value)).toThrow(new ParseRefusal('parse_failed'));
	});

	it('accepts the statement of a bank CSV export that names its layout', () => {
		const result = validateParseOutput({
			...output([], {format: 'csv', layout: 'example-bank'}),
			formats: ['csv'],
			layouts: ['example-bank'],
		});

		expect(result).toMatchObject({
			ok: true,
			result: {
				formats: ['csv'],
				layouts: ['example-bank'],
				statements: [{format: 'csv', layout: 'example-bank'}],
			},
		});
	});

	it('passes a refusal code the child may use, with the layout of a CSV near miss', () => {
		expect(validateParseOutput({ok: false, code: 'archive_too_large'})).toEqual({
			ok: false,
			code: 'archive_too_large',
		});
		expect(validateParseOutput({ok: false, code: 'layout_not_recognized', layout: 'example-bank'})).toEqual({
			ok: false,
			code: 'layout_not_recognized',
			layout: 'example-bank',
		});
	});

	it.each([
		{name: 'not an object', value: 'rows'},
		{name: 'an unknown file format', value: {...output([]), formats: ['qif']}},
		{name: 'an unknown statement format', value: output([], {format: 'qif'})},
		{name: 'a CSV statement without its layout', value: {...output([], {format: 'csv'}), formats: ['csv']}},
		{
			name: 'a layout on a statement in a standard format',
			value: {...output([], {layout: 'example-bank'}), layouts: ['example-bank']},
		},
		{
			name: 'a CSV statement whose layout none of the files has',
			value: {...output([], {format: 'csv', layout: 'example-bank'}), formats: ['csv'], layouts: ['other-bank']},
		},
		{name: 'a layout id that is not one', value: {...output([]), formats: ['csv'], layouts: ['Example Bank']}},
		{name: 'a near miss of a CSV layout that names none', value: {ok: false, code: 'layout_not_recognized'}},
		{name: 'a layout on another refusal', value: {ok: false, code: 'parse_failed', layout: 'example-bank'}},
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

describe('validateSampleOutput', () => {
	const sample = (masked: Record<string, unknown> = {}) => ({
		ok: true,
		sample: {
			shape: {source: 'text', delimiter: ';', quote: '"', encoding: 'utf-8'},
			columnCount: 3,
			skipBefore: 1,
			skipAfter: 0,
			header: ['Datum', 'Bedrag', 'Af Bij'],
			rowCount: 2,
			masked: {
				header: ['Datum', 'Bedrag', 'Af Bij'],
				linesAbove: [{line: 0, cells: ['Aaaaaaaa AA99AAAA9999999999', 'EUR']}],
				rows: [['99-99-9999', '-99,99', 'Af']],
				linesBelow: [],
				columnShapes: ['99-99-9999', '-99,99', 'Aa'],
				...masked,
			},
		},
	});

	it('passes a masked sample with its header, currency codes and short repeated values', () => {
		expect(validateSampleOutput(sample())).toEqual(sample());
	});

	it.each([
		{name: 'a row cell with a digit', masked: {rows: [['99-99-9999', '-12,50', 'Af']]}},
		{name: 'a long unmasked row cell', masked: {rows: [['99-99-9999', '-99,99', 'Example Lender BV']]}},
		{name: 'an unmasked line above', masked: {linesAbove: [{line: 0, cells: ['Rekening']}]}},
		{name: 'an unmasked column shape', masked: {columnShapes: ['99-99-9999', '-99,99', 'Af']}},
		{name: 'more rows than three', masked: {rows: Array.from({length: 4}, () => ['9', '9', 'Af'])}},
	])('refuses a sample with $name', ({masked}) => {
		expect(() => validateSampleOutput(sample(masked))).toThrow(new ParseRefusal('parse_failed'));
	});
});
