import {validateCsvLayout} from './csv-layout';
import {CSV_LAYOUTS} from './csv-layouts';

const [ING] = CSV_LAYOUTS;

describe('validateCsvLayout', () => {
	it('accepts every layout Tempo ships, as plain JSON', () => {
		for (const layout of CSV_LAYOUTS) {
			expect(validateCsvLayout(JSON.parse(JSON.stringify(layout)))).toEqual({ok: true, layout});
		}
		expect(new Set(CSV_LAYOUTS.map(({id}) => id)).size).toBe(CSV_LAYOUTS.length);
	});

	const {bookingDate: _bookingDate, ...withoutBookingDate} = ING;
	it.each([
		{
			name: 'an unknown field',
			value: {...ING, thousandsSeparator: '.'},
			error: 'layout: unknown thousandsSeparator',
		},
		{name: 'a missing required field', value: withoutBookingDate, error: 'layout: missing bookingDate'},
		{
			name: 'an unknown field in the amount',
			value: {...ING, amount: {kind: 'signed', column: 6, sign: '-'}},
			error: 'amount: unknown sign',
		},
		{name: 'an unknown kind of amount', value: {...ING, amount: {kind: 'percent'}}, error: 'amount.kind'},
		{name: 'a column outside the row', value: {...ING, accountIban: 9}, error: 'accountIban'},
		{name: 'a description column outside the row', value: {...ING, description: [8, 9]}, error: 'description'},
		{name: 'an id that is not one', value: {...ING, id: 'ING NL'}, error: 'id'},
		{name: 'a fixed currency that is not a code', value: {...ING, currency: {fixed: 'euro'}}, error: 'currency'},
		{name: 'a fixed currency that is not text', value: {...ING, currency: {fixed: ['EUR']}}, error: 'currency'},
		{
			name: 'a currency both fixed and in a column',
			value: {...ING, currency: {fixed: 'EUR', column: 1}},
			error: 'currency',
		},
		{
			name: 'the same value for debit and credit',
			value: {...ING, amount: {kind: 'direction', column: 6, directionColumn: 5, debit: 'Af', credit: 'Af'}},
			error: 'amount.credit',
		},
		{
			name: 'a file without a header that names no bank to hold its accounts',
			value: {...ING, recognize: {columnCount: 9, accountBankCodes: []}},
			error: 'recognize.accountBankCodes',
		},
		{
			name: 'both a header and a column count',
			value: {...ING, recognize: {header: ['Datum'], columnCount: 1}},
			error: 'recognize',
		},
		{name: 'not an object', value: [ING], error: 'layout'},
	])('refuses a layout with $name', ({value, error}) => {
		expect(validateCsvLayout(value)).toEqual({ok: false, error});
	});

	const OWNED = {
		id: 'learned-example',
		bank: 'Example Bank',
		recognize: {header: ['Datum', 'Bedrag', 'Af', 'Bij', 'Saldo', 'Munt']},
		delimiter: '|',
		quote: '"',
		encoding: 'utf-8',
		skipBefore: 3,
		skipAfter: 2,
		decimalMark: ',',
		amountStyle: {thousandsSeparator: '.'},
		dateFormat: 'DD.MM.YY',
		accountIbanLine: 1,
		currency: {column: 5},
		bookingDate: 0,
		amount: {kind: 'debitCredit', debitColumn: 2, creditColumn: 3},
		description: [],
	};
	const {delimiter: _delimiter, quote: _quote, encoding: _encoding, ...workbook} = OWNED;

	it("accepts an owner's layout with every new option, from text or a workbook", () => {
		expect(validateCsvLayout(OWNED)).toEqual({ok: true, layout: OWNED});
		expect(validateCsvLayout({...workbook, source: 'xlsx'})).toEqual({
			ok: true,
			layout: {...workbook, source: 'xlsx'},
		});
		const headerless = {...OWNED, recognize: {columnCount: 6}};
		expect(validateCsvLayout(headerless)).toEqual({ok: true, layout: headerless});
	});

	it.each([
		{name: 'an unknown source', value: {...OWNED, source: 'pdf'}, error: 'source'},
		{
			name: 'a workbook with a delimiter',
			value: {...workbook, source: 'xlsx', delimiter: ';'},
			error: 'layout: unknown delimiter',
		},
		{name: 'text without a delimiter', value: {...workbook, source: 'text'}, error: 'layout: missing delimiter'},
		{name: 'an unknown delimiter', value: {...OWNED, delimiter: ':'}, error: 'delimiter'},
		{name: 'too many lines skipped above', value: {...OWNED, skipBefore: 51}, error: 'skipBefore'},
		{name: 'a negative skip above', value: {...OWNED, skipBefore: -1}, error: 'skipBefore'},
		{name: 'too many lines skipped below', value: {...OWNED, skipAfter: 11}, error: 'skipAfter'},
		{
			name: 'skipped lines next to a preamble',
			value: {...OWNED, recognize: {...OWNED.recognize, preamble: [['Example']]}},
			error: 'skipBefore',
		},
		{
			name: 'an account line below the skipped lines',
			value: {...OWNED, accountIbanLine: 3},
			error: 'accountIbanLine',
		},
		{name: 'an account line and column', value: {...OWNED, accountIban: 0}, error: 'accountIbanLine'},
		{
			name: 'an unknown thousands separator',
			value: {...OWNED, amountStyle: {thousandsSeparator: '_'}},
			error: 'amountStyle.thousandsSeparator',
		},
		{
			name: 'a thousands separator equal to the decimal mark',
			value: {...OWNED, amountStyle: {thousandsSeparator: ','}},
			error: 'amountStyle.thousandsSeparator',
		},
		{
			name: 'an unknown field in the amount style',
			value: {...OWNED, amountStyle: {thousandsSeparator: null, symbol: '€'}},
			error: 'amountStyle: unknown symbol',
		},
		{
			name: 'an amount style without its separator',
			value: {...OWNED, amountStyle: {}},
			error: 'amountStyle: missing thousandsSeparator',
		},
		{name: 'an unknown date format', value: {...OWNED, dateFormat: 'D/M/Y'}, error: 'dateFormat'},
		{
			name: 'one column for debit and credit',
			value: {...OWNED, amount: {kind: 'debitCredit', debitColumn: 2, creditColumn: 2}},
			error: 'amount.creditColumn',
		},
		{
			name: 'a credit column outside the row',
			value: {...OWNED, amount: {kind: 'debitCredit', debitColumn: 2, creditColumn: 6}},
			error: 'amount.creditColumn',
		},
		{
			name: 'an unknown field in a debit and credit amount',
			value: {...OWNED, amount: {kind: 'debitCredit', debitColumn: 2, creditColumn: 3, column: 1}},
			error: 'amount: unknown column',
		},
		{
			name: 'a file without a header that checks nothing but a date and an amount',
			value: {...OWNED, recognize: {columnCount: 6}, accountIbanLine: undefined, currency: {fixed: 'EUR'}},
			error: 'recognize.columnCount',
		},
		{
			name: 'a file without a header whose only other date is its booking date',
			value: {
				...OWNED,
				recognize: {columnCount: 6},
				accountIbanLine: undefined,
				currency: {fixed: 'EUR'},
				valueDate: 0,
			},
			error: 'recognize.columnCount',
		},
		{
			name: 'a file without a header whose currency column is one of its amounts',
			value: {...OWNED, recognize: {columnCount: 6}, accountIbanLine: undefined, currency: {column: 2}},
			error: 'recognize.columnCount',
		},
	])("refuses an owner's layout with $name", ({value, error}) => {
		expect(validateCsvLayout(JSON.parse(JSON.stringify(value)))).toEqual({ok: false, error});
	});
});
