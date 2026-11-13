import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {createWorkbook} from '../../../../../test/fixtures/statement-file.fixture';
import {CsvLayout} from './csv-layout';
import {readCsvLayout} from './csv-layout-reader';
import {CSV_LAYOUTS} from './csv-layouts';
import {parseFile} from './parse-file';
import {ParseRefusal} from './parse-result';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/file-import');
// Read as Latin-1 so that every byte, including the Windows-1252 export's, survives a round trip.
const fixture = (name: string) => readFileSync(join(FIXTURES, name)).toString('latin1');
const file = (text: string) => Buffer.from(text, 'latin1');
/** Every statement's IBAN and the dates and amounts of its rows. */
const summary = (text: string) =>
	parseFile(file(text)).statements.map(({accountIban, rows}) => ({
		accountIban,
		rows: rows.map(({bookingDate, amount, balanceAfter}) => [bookingDate, amount, balanceAfter]),
	}));

/** The refusal parsing the text ends in, with the layout a near miss names. */
function refusal(text: string | Buffer, owned: CsvLayout[] = []): {code: string; layout: string | null} {
	try {
		parseFile(typeof text === 'string' ? file(text) : text, owned);
	} catch (error) {
		if (error instanceof ParseRefusal) return {code: error.code, layout: error.layout};
		throw error;
	}
	throw new Error('The file was read');
}

// A valid IBAN at a bank in the same family as ASN Bank, whose exports share its shape.
const OTHER_FAMILY_IBAN = 'NL76SNSB0900000001';

describe('bank CSV layouts', () => {
	it('reads the statements of two accounts in one file, in booking order whichever way the file lists them', () => {
		const text = fixture('rabobank-synthetic.csv');
		const [header, ...rows] = text.trimEnd().split('\r\n');

		const forward = summary(text);
		const newestFirst = summary([header, ...rows.reverse(), ''].join('\r\n'));

		expect(forward).toEqual([
			{
				accountIban: 'NL38RABO0300000001',
				rows: [
					['2026-03-02', '-12.50', '987.50'],
					['2026-03-03', '-250.00', '737.50'],
					['2026-03-04', '2500.00', '3237.50'],
					['2026-03-05', '-39.99', '3197.51'],
				],
			},
			{accountIban: 'NL11RABO0300000002', rows: [['2026-03-02', '250.00', '5250.00']]},
		]);
		expect(newestFirst).toEqual(forward);
	});

	it('reads a Windows-1252 layout from a UTF-8 file too, and recognises a header by its trimmed, case-folded cells', () => {
		const rabobank = fixture('rabobank-synthetic.csv');
		const utf8 = Buffer.from(rabobank, 'utf8');
		const ing = fixture('ing-synthetic.csv')
			.replace('"MutatieSoort"', '"Mutatiesoort"')
			.replace('"Datum"', '" DATUM "');

		expect(parseFile(utf8).statements).toEqual(parseFile(file(rabobank)).statements);
		expect(parseFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), file(ing)]))).toEqual(
			parseFile(file(fixture('ing-synthetic.csv'))),
		);
	});

	it.each([
		{
			layout: 'ing-nl',
			name: 'ing-synthetic.csv',
			change: 'swapped columns',
			from: '"Af","24,95"',
			to: '"24,95","Af"',
		},
		{
			layout: 'ing-nl',
			name: 'ing-synthetic.csv',
			change: 'a date in another format',
			from: '"20260305"',
			to: '"05-03-2026"',
		},
		{
			layout: 'ing-nl',
			name: 'ing-synthetic.csv',
			change: 'an account IBAN that fails its checksum',
			from: '"NL20INGB0001234567"',
			to: '"NL21INGB0001234567"',
		},
		{layout: 'ing-nl', name: 'ing-synthetic.csv', change: 'an unknown direction', from: '"Af"', to: '"Debit"'},
		{
			layout: 'ing-nl',
			name: 'ing-synthetic.csv',
			change: 'a counterparty account that is neither an IBAN nor an account number',
			from: '"NL91ABNA0417164300"',
			to: '"NL91ABNA041716430!"',
		},
		{
			layout: 'rabobank-nl',
			name: 'rabobank-synthetic.csv',
			change: 'swapped columns',
			from: '"2026-03-02","2026-03-02","-12,50"',
			to: '"-12,50","2026-03-02","2026-03-02"',
		},
		{
			layout: 'rabobank-nl',
			name: 'rabobank-synthetic.csv',
			change: 'a date in another format',
			from: '"2026-03-04","2026-03-04"',
			to: '"04-03-2026","2026-03-04"',
		},
		{
			layout: 'rabobank-nl',
			name: 'rabobank-synthetic.csv',
			change: 'a counterparty IBAN that fails its checksum',
			from: 'DE89370400440532013000',
			to: 'DE89370400440532013001',
		},
		{
			layout: 'rabobank-nl',
			name: 'rabobank-synthetic.csv',
			change: 'a balance that does not follow the amounts',
			from: '"+737,50"',
			to: '"+737,05"',
		},
		{
			layout: 'bunq-nl',
			name: 'bunq-nl-synthetic.csv',
			change: 'swapped columns',
			from: '"2026-03-02","-4,50"',
			to: '"-4,50","2026-03-02"',
		},
		{
			layout: 'bunq-nl',
			name: 'bunq-nl-synthetic.csv',
			change: 'a date in another format',
			from: '"2026-03-03"',
			to: '"2026/03/03"',
		},
		{
			layout: 'bunq-nl',
			name: 'bunq-nl-synthetic.csv',
			change: 'a counterparty IBAN that fails its checksum',
			from: 'NL91ABNA0417164300',
			to: 'NL91ABNA0417164301',
		},
		{
			layout: 'bunq-nl',
			name: 'bunq-nl-synthetic.csv',
			change: 'a byte that is not UTF-8',
			from: 'Naar bunq',
			to: 'Naar b\xfcnq',
		},
		{
			layout: 'bunq-en',
			name: 'bunq-en-synthetic.csv',
			change: 'a date in another format',
			from: '"2026-03-05"',
			to: '"20260305"',
		},
		{
			layout: 'bunq-en',
			name: 'bunq-en-synthetic.csv',
			change: 'an account IBAN that fails its checksum',
			from: '"NL86BUNQ2000000001"',
			to: '"NL87BUNQ2000000001"',
		},
		{
			layout: 'knab-nl',
			name: 'knab-synthetic.csv',
			change: 'swapped columns',
			from: '"D";"24,95"',
			to: '"24,95";"D"',
		},
		{
			layout: 'knab-nl',
			name: 'knab-synthetic.csv',
			change: 'a date in another format',
			from: '"05-03-2026";"EUR"',
			to: '"2026-03-05";"EUR"',
		},
		{
			layout: 'knab-nl',
			name: 'knab-synthetic.csv',
			change: 'an account IBAN that fails its checksum',
			from: '"NL71KNAB0100000001"',
			to: '"NL71KNAB0100000002"',
		},
		{
			layout: 'knab-nl',
			name: 'knab-synthetic.csv',
			change: 'a currency that is not a code',
			from: '"EUR"',
			to: '"Euro"',
		},
		{layout: 'knab-nl', name: 'knab-synthetic.csv', change: 'a missing column', from: '"Huur maart";', to: ''},
	])('refuses a $layout file with $change as layout_not_recognized', ({layout, name, from, to}) => {
		const text = fixture(name);
		expect(text).toContain(from);

		expect(refusal(text.replace(from, to))).toEqual({code: 'layout_not_recognized', layout});
	});

	it.each([
		{
			change: 'a balance that does not follow the amounts',
			from: 'EUR,50.00,EUR,2500.00',
			to: 'EUR,51.00,EUR,2500.00',
		},
		{change: 'a date in another format', from: '02-03-2026,NL33', to: '2026-03-02,NL33'},
		{change: 'an account IBAN that fails its checksum', from: 'NL33ASNB0700000001', to: 'NL34ASNB0700000001'},
		{change: 'the account of another bank', from: /NL33ASNB0700000001/g, to: OTHER_FAMILY_IBAN},
	])(
		'leaves an ASN Bank file with $change unclaimed, since the export has no header, as a table of no known layout',
		({from, to}) => {
			const text = fixture('asn-synthetic.csv');
			expect(text).toMatch(from);

			expect(refusal(text.replace(from, to))).toEqual({code: 'layout_unknown', layout: null});
		},
	);

	it.each([
		{
			name: 'any CSV with as many columns',
			text: `${Array.from({length: 19}, (_, index) => `c${index}`).join(',')}\n`,
		},
		{name: 'a file without rows', text: '\n\n'},
	])('leaves $name to no layout', ({text}) => {
		expect(refusal(text)).toEqual({code: 'unsupported_format', layout: null});
	});
});

/** The owner's layouts the fixtures of other shapes are read with. */
const DEBIT_CREDIT: CsvLayout = {
	id: 'learned-debit-credit',
	bank: 'Example Bank',
	recognize: {
		header: ['Buchungstag', 'Valuta', 'Auftraggeber/Empfänger', 'Verwendungszweck', 'Soll', 'Haben', 'Währung'],
	},
	delimiter: ';',
	quote: '"',
	encoding: 'utf-8',
	skipBefore: 3,
	decimalMark: ',',
	amountStyle: {thousandsSeparator: '.'},
	dateFormat: 'DD.MM.YYYY',
	accountIbanLine: 1,
	currency: {column: 6},
	bookingDate: 0,
	valueDate: 1,
	amount: {kind: 'debitCredit', debitColumn: 4, creditColumn: 5},
	counterpartyName: 2,
	description: [3],
};
const BALANCE: CsvLayout = {
	id: 'learned-balance',
	bank: 'Example Bank',
	recognize: {header: ['Date', 'Description', 'Type', 'Amount', 'Balance']},
	delimiter: ',',
	quote: '"',
	encoding: 'utf-8',
	decimalMark: '.',
	amountStyle: {thousandsSeparator: ','},
	dateFormat: 'DD/MM/YYYY',
	currency: {fixed: 'GBP'},
	bookingDate: 0,
	amount: {kind: 'signed', column: 3},
	balance: {column: 4, when: 'after'},
	description: [1],
};
const HEADERLESS: CsvLayout = {
	id: 'learned-headerless',
	bank: 'Example Bank',
	recognize: {columnCount: 4},
	delimiter: ';',
	quote: '"',
	encoding: 'utf-8',
	decimalMark: '.',
	dateFormat: 'YYYY-MM-DD',
	currency: {column: 2},
	bookingDate: 0,
	amount: {kind: 'signed', column: 1},
	description: [3],
};
const WORKBOOK: CsvLayout = {
	id: 'learned-workbook',
	bank: 'Example Bank',
	recognize: {header: ['Date', 'Details', 'Amount']},
	source: 'xlsx',
	skipBefore: 1,
	decimalMark: '.',
	dateFormat: 'DD/MM/YYYY',
	currency: {fixed: 'EUR'},
	bookingDate: 0,
	amount: {kind: 'signed', column: 2},
	description: [1],
};
const WORKBOOK_ROWS: Array<Array<string | number | null>> = [
	['Example statement'],
	['Date', 'Details', 'Amount'],
	// A day serial and a date written as text, a number and an amount written as text.
	[46083, 'Example Shop', -12.5],
	['04/03/2026', 'Example Employer', '2500.00'],
];
const ROWS_OF = (layout: CsvLayout, text: string | Buffer, today = '2026-11-13') =>
	readCsvLayout(typeof text === 'string' ? file(text) : text, [layout], {owned: true, today})?.statements.map(
		({accountIban, bank, accountCurrency, rows}) => ({
			accountIban,
			bank,
			accountCurrency,
			rows: rows.map(({bookingDate, amount, balanceAfter}) => [bookingDate, amount, balanceAfter]),
		}),
	) ?? null;

describe("an owner's saved layouts", () => {
	it('read debit and credit columns, thousands separators and the account IBAN on a line above the header', () => {
		expect(ROWS_OF(DEBIT_CREDIT, fixture('debit-credit-synthetic.csv'))).toEqual([
			{
				accountIban: 'DE89370400440532013000',
				bank: null,
				accountCurrency: 'EUR',
				rows: [
					['2026-03-02', '-12.50', null],
					['2026-03-03', '-850.00', null],
					['2026-03-04', '2500.00', null],
					['2026-03-05', '-39.99', null],
				],
			},
		]);
	});

	it('read a file that names no account under the layout bank, with a balance and amounts in quotes', () => {
		expect(ROWS_OF(BALANCE, fixture('balance-synthetic.csv'))).toEqual([
			{
				accountIban: null,
				bank: 'Example Bank',
				accountCurrency: 'GBP',
				rows: [
					['2026-03-02', '-4.50', '995.50'],
					['2026-03-03', '-650.00', '345.50'],
					['2026-03-04', '1800.00', '2145.50'],
					['2026-03-05', '-23.10', '2122.40'],
				],
			},
		]);
	});

	it('read a file without a header, and the first sheet of a workbook', () => {
		expect(ROWS_OF(HEADERLESS, fixture('headerless-synthetic.csv'))?.[0].rows).toHaveLength(4);
		expect(ROWS_OF(WORKBOOK, createWorkbook(WORKBOOK_ROWS))).toEqual([
			{
				accountIban: null,
				bank: 'Example Bank',
				accountCurrency: 'EUR',
				rows: [
					['2026-03-02', '-12.50', null],
					['2026-03-04', '2500.00', null],
				],
			},
		]);
	});

	it.each([
		{
			name: 'parentheses, a trailing minus and currency symbols',
			cells: ['(4.50)', '650.00-', '£1,800.00', '-£23.10'],
			amounts: ['-4.50', '-650.00', '1800.00', '-23.10'],
		},
		{
			name: 'a currency code and a time after the date',
			cells: ['GBP -4.50', '-650.00 GBP', '1,800.00', '-23.10'],
			amounts: ['-4.50', '-650.00', '1800.00', '-23.10'],
			dates: ['02/03/2026 09:15', '03/03/2026 23:59:59', '04/03/2026', '05/03/2026 8:00 AM'],
		},
	])('read amounts with $name', ({cells, amounts, dates}) => {
		const text = [
			'Date,Description,Type,Amount',
			...cells.map((amount, index) => `${dates?.[index] ?? `0${index + 2}/03/2026`},Example,DEB,"${amount}"`),
			'',
		].join('\n');
		const layout: CsvLayout = {
			...BALANCE,
			recognize: {header: ['Date', 'Description', 'Type', 'Amount']},
			balance: undefined,
		};
		delete layout.balance;

		expect(ROWS_OF(layout, Buffer.from(text, 'utf8'))?.[0].rows.map(([, amount]) => amount)).toEqual(amounts);
	});

	it.each([
		{name: 'a row with both debit and credit', layout: DEBIT_CREDIT, from: '12,50;;EUR', to: '12,50;1,00;EUR'},
		{name: 'a row with neither debit nor credit', layout: DEBIT_CREDIT, from: '12,50;;EUR', to: ';;EUR'},
		{name: 'a line without an IBAN', layout: DEBIT_CREDIT, from: 'DE89 3704 0044 0532 0130 00', to: 'Girokonto'},
		{name: 'an IBAN that fails its checksum', layout: DEBIT_CREDIT, from: 'DE89 3704', to: 'DE88 3704'},
		{name: 'a misgrouped thousands separator', layout: DEBIT_CREDIT, from: '2.500,00', to: '25.00,00'},
		{name: 'a balance that does not follow', layout: BALANCE, from: '345.50', to: '345.60'},
		{name: 'a date in another format', layout: BALANCE, from: '03/03/2026', to: '2026-03-03'},
		{
			name: 'a date before 1990',
			layout: BALANCE,
			from: '02/03/2026,EXAMPLE CAFE,DEB,-4.50,995.50',
			to: '02/03/1989,EXAMPLE CAFE,DEB,-4.50,995.50',
		},
		{name: 'a date over a year ahead', layout: BALANCE, from: '05/03/2026', to: '05/03/2028'},
		{
			name: 'a third column that does not read',
			layout: HEADERLESS,
			from: '2026-03-03;-850.00;EUR',
			to: '2026-03-03;-850.00;Euro',
		},
	])('refuse a file with $name', ({layout, from, to}) => {
		const text = fixture(
			layout === DEBIT_CREDIT
				? 'debit-credit-synthetic.csv'
				: layout === BALANCE
					? 'balance-synthetic.csv'
					: 'headerless-synthetic.csv',
		);
		expect(text).toContain(from);

		// A header that matches makes the file a near miss of the layout; without one, nothing claims it.
		expect(refusal(text.replace(from, to), [layout])).toEqual(
			'header' in layout.recognize
				? {code: 'layout_not_recognized', layout: layout.id}
				: {code: 'layout_unknown', layout: null},
		);
	});

	it('read a negative entry by its sign: a negative money in is money out, a negative money out is money in', () => {
		const layout: CsvLayout = {
			id: 'learned-reversals',
			bank: 'Example Bank',
			recognize: {header: ['Date', 'Out', 'In', 'Balance']},
			delimiter: ';',
			quote: '"',
			encoding: 'utf-8',
			decimalMark: ',',
			dateFormat: 'DD.MM.YYYY',
			currency: {fixed: 'EUR'},
			bookingDate: 0,
			amount: {kind: 'debitCredit', debitColumn: 1, creditColumn: 2},
			balance: {column: 3, when: 'after'},
			description: [],
		};
		const file = (balances: string[]) =>
			[
				'Date;Out;In;Balance',
				`01.03.2026;10,00;;${balances[0]}`,
				`02.03.2026;;-5,00;${balances[1]}`,
				`03.03.2026;-2,00;;${balances[2]}`,
				'',
			].join('\n');

		expect(ROWS_OF(layout, file(['90,00', '85,00', '87,00']))?.[0].rows).toEqual([
			['2026-03-01', '-10.00', '90.00'],
			['2026-03-02', '-5.00', '85.00'],
			['2026-03-03', '2.00', '87.00'],
		]);
		// Balances that follow the entries as unsigned amounts on their column's side do not agree.
		expect(refusal(file(['90,00', '95,00', '93,00']), [layout])).toEqual({
			code: 'layout_not_recognized',
			layout: 'learned-reversals',
		});
	});

	describe('with money out and money in columns', () => {
		const layout = (balance: boolean): CsvLayout => ({
			id: 'learned-sides',
			bank: 'Example Bank',
			recognize: {header: balance ? ['Date', 'Out', 'In', 'Balance'] : ['Date', 'Out', 'In']},
			delimiter: ';',
			quote: '"',
			encoding: 'utf-8',
			decimalMark: ',',
			dateFormat: 'DD.MM.YYYY',
			currency: {fixed: 'EUR'},
			bookingDate: 0,
			amount: {kind: 'debitCredit', debitColumn: 1, creditColumn: 2},
			...(balance ? {balance: {column: 3, when: 'after' as const}} : {}),
			description: [],
		});
		const file = (rows: string[], balance = false) =>
			[balance ? 'Date;Out;In;Balance' : 'Date;Out;In', ...rows, ''].join('\n');
		const amounts = (text: string, balance = false) =>
			ROWS_OF(layout(balance), text)?.[0].rows.map(([, amount]) => amount);

		it('read a money out column written all negative as money out, by size', () => {
			expect(
				amounts(file(['01.03.2026;-10,00;', '02.03.2026;;5,00', '03.03.2026;-2,50;', '04.03.2026;0,00;1,00'])),
			).toEqual(['-10.00', '5.00', '-2.50', '1.00']);
		});

		it('read a negative entry among positive money out as money in, a reversal', () => {
			expect(amounts(file(['01.03.2026;10,00;', '02.03.2026;-2,00;', '03.03.2026;;5,00']))).toEqual([
				'-10.00',
				'2.00',
				'5.00',
			]);
			// The whole column decides, so a negative entry before the first positive one is money in too.
			expect(amounts(file(['01.03.2026;-2,00;', '02.03.2026;10,00;']))).toEqual(['2.00', '-10.00']);
		});

		it('keep the balance check on the amounts as read, and refuse balances that contradict them', () => {
			const allNegative = (balances: string[]) =>
				file(
					[
						`01.03.2026;-10,00;;${balances[0]}`,
						`02.03.2026;;5,00;${balances[1]}`,
						`03.03.2026;-2,50;;${balances[2]}`,
					],
					true,
				);
			const reversal = (balances: string[]) =>
				file(
					[
						`01.03.2026;10,00;;${balances[0]}`,
						`02.03.2026;-2,00;;${balances[1]}`,
						`03.03.2026;;5,00;${balances[2]}`,
					],
					true,
				);

			expect(amounts(allNegative(['90,00', '95,00', '92,50']), true)).toEqual(['-10.00', '5.00', '-2.50']);
			expect(amounts(reversal(['90,00', '92,00', '97,00']), true)).toEqual(['-10.00', '2.00', '5.00']);
			// Balances that follow the other reading of each file.
			const nearMiss = {code: 'layout_not_recognized', layout: 'learned-sides'};
			expect(refusal(allNegative(['110,00', '115,00', '117,50']), [layout(true)])).toEqual(nearMiss);
			expect(refusal(reversal(['90,00', '88,00', '93,00']), [layout(true)])).toEqual(nearMiss);
		});
	});

	it('refuse a file whose amounts are all zero, and a header without rows', () => {
		const zero = ['Date,Description,Type,Amount,Balance', '02/03/2026,Example,DEB,0.00,1.00', ''].join('\n');
		const nearMiss = {code: 'layout_not_recognized', layout: BALANCE.id};
		expect(refusal(zero, [BALANCE])).toEqual(nearMiss);
		expect(refusal('Date,Description,Type,Amount,Balance\n', [BALANCE])).toEqual(nearMiss);
	});

	it('flag a file whose every date reads day first and month first, with one that reads differently', () => {
		const read = (text: string) =>
			readCsvLayout(file(text), [BALANCE], {owned: true, today: '2026-11-13'})?.dateCheck;

		expect(read(fixture('balance-synthetic.csv'))).toEqual({written: '02/03/2026', date: '2026-03-02'});
		expect(read(fixture('balance-synthetic.csv').replace('05/03/2026', '25/03/2026'))).toBeNull();
	});

	it('are tried after every built-in layout and reader, and read a near miss of a built-in layout', () => {
		const ing = fixture('ing-synthetic.csv');
		const lookalike: CsvLayout = {...CSV_LAYOUTS[0], id: 'learned-ing', bank: 'Example Bank'};
		expect(parseFile(file(ing), [lookalike]).layouts).toEqual(['ing-nl']);

		const moved = ing.replace('"20260305"', '"05-03-2026"');
		expect(refusal(moved)).toEqual({code: 'layout_not_recognized', layout: 'ing-nl'});
		const fixed = {...CSV_LAYOUTS[0], id: 'learned-ing', bank: 'ING'} as CsvLayout;
		expect(refusal(moved, [{...fixed, dateFormat: 'YYYYMMDD'}])).toEqual({
			code: 'layout_not_recognized',
			layout: 'ing-nl',
		});
		const otherDates = moved.replace(/"(\d{4})(\d{2})(\d{2})"/g, '"$3-$2-$1"');
		expect(parseFile(file(otherDates), [{...fixed, dateFormat: 'DD-MM-YYYY'}]).layouts).toEqual(['learned-ing']);
	});

	it('leave a table no saved layout reads to the column mapper', () => {
		expect(refusal(fixture('balance-synthetic.csv'), [HEADERLESS])).toEqual({code: 'layout_unknown', layout: null});
		expect(refusal(createWorkbook(WORKBOOK_ROWS))).toEqual({code: 'layout_unknown', layout: null});
		expect(parseFile(createWorkbook(WORKBOOK_ROWS), [WORKBOOK]).layouts).toEqual(['learned-workbook']);
	});
});
