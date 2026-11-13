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
		{name: 'an unknown kind of amount', value: {...ING, amount: {kind: 'debitCredit'}}, error: 'amount.kind'},
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
});
