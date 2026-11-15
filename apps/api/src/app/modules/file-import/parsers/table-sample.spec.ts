import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {createWorkbook} from '../../../../../test/fixtures/statement-file.fixture';
import {validateSampleOutput} from '../runner/validate-parse-output';
import {maskTable} from './table-mask';
import {sampleTable} from './table-sample';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/file-import');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

describe('maskTable', () => {
	it('masks letters by case and digits, keeps punctuation, spaces and length, and cuts a cell at 60 characters', () => {
		const masked = maskTable({
			header: null,
			linesAbove: [],
			rows: [['Ünïcode Ex-Shop 12,50 €', 'x'.repeat(70)]],
			linesBelow: [],
			columnCount: 2,
		});

		expect(masked.rows).toEqual([['Aaaaaaa Aa-Aaaa 99,99 €', 'a'.repeat(60)]]);
	});

	it('sends header cells, currency codes and the words of a direction column as written', () => {
		const rows = [
			['Af', 'EUR', 'Jan Example', '1,00'],
			['Bij', 'EUR', 'Example Cafe', '2,00'],
			['Af', 'USD', 'Example Shop', '3,00'],
			['Bij', 'EUR', 'Example Bar', '4,00'],
		];
		const masked = maskTable({
			header: ['Af Bij', 'Munt', `Naam ${'n'.repeat(90)}`, 'Bedrag'],
			linesAbove: [{line: 0, cells: ['Rekening NL91ABNA0417164300', 'EUR']}],
			rows,
			linesBelow: [['Totaal', '10,00']],
			columnCount: 4,
		});

		expect(masked).toEqual({
			header: ['Af Bij', 'Munt', `Naam ${'n'.repeat(75)}`, 'Bedrag'],
			linesAbove: [{line: 0, cells: ['Aaaaaaaa AA99AAAA9999999999', 'EUR']}],
			rows: [
				['Af', 'EUR', 'Aaa Aaaaaaa', '9,99'],
				['Bij', 'EUR', 'Aaaaaaa Aaaa', '9,99'],
				['Bij', 'EUR', 'Aaaaaaa Aaa', '9,99'],
			],
			linesBelow: [['Aaaaaa', '99,99']],
			columnShapes: ['Aa', 'AAA', 'Aaa Aaaaaaa', '9,99'],
			columns: expect.any(Array),
		});
	});

	it.each([
		{name: 'no value written twice', column: ['Jan Example', 'Example Shop', 'Example Bar']},
		{name: 'a value with a digit', column: ['Example 1', 'Example 1', 'Example 1']},
		{name: 'a value over 12 characters', column: ['Example Lender', 'Example Lender', 'Example Lender']},
		{name: 'two short names, one written twice', column: ['Corner Shop', 'Gym Club', 'Corner Shop']},
		{name: 'one short name on every row', column: ['Example', 'Example', 'Example']},
	])('masks every value of a column with $name', ({column}) => {
		const masked = maskTable({
			header: null,
			linesAbove: [],
			rows: column.map((value) => [value, '1']),
			linesBelow: [],
			columnCount: 2,
		});

		for (const [value] of masked.rows) expect(value).toMatch(/^[aA9 ]+$/);
	});

	it.each([
		{name: 'D and C', column: ['D', 'C', 'D'], sent: ['D', 'C', 'D']},
		{name: 'Debit and Credit, each written once', column: ['Debit', 'Credit'], sent: ['Debit', 'Credit']},
		{name: 'Soll and Haben', column: ['Soll', 'Haben', 'Haben'], sent: ['Soll', 'Haben', 'Haben']},
		{
			name: 'a date column that says offen until the payment is booked',
			column: ['offen', '05.10.2026', '02.10.2026'],
			sent: ['offen', '99.99.9999', '99.99.9999'],
		},
		{
			name: 'a status word beside a name, which stays masked',
			column: ['Gebucht', 'Example', 'VORGEMERKT'],
			sent: ['Gebucht', 'Aaaaaaa', 'VORGEMERKT'],
		},
	])('sends the words of a direction or status column as written: $name', ({column, sent}) => {
		const masked = maskTable({
			header: null,
			linesAbove: [],
			rows: column.map((value) => [value]),
			linesBelow: [],
			columnCount: 1,
		});

		expect(masked.rows.map(([value]) => value)).toEqual(sent);
	});

	it('masks a header cell with a digit, which a header never needs', () => {
		const masked = maskTable({
			header: ['Datum', 'Rekening NL91ABNA0417164300'],
			linesAbove: [],
			rows: [['1', '2']],
			linesBelow: [],
			columnCount: 2,
		});

		expect(masked.header).toEqual(['Datum', 'Aaaaaaaa AA99AAAA9999999999']);
	});

	it('lists the distinct shapes each column takes over the whole table, most frequent first, and whether it repeats one value', () => {
		const iban = 'DE89370400440532013000';
		const masked = maskTable({
			header: null,
			linesAbove: [],
			rows: [
				['12,50', iban, 'Af', 'Example Shop'],
				['1.234,56', iban, 'Bij', 'Example Shop'],
				['', iban, 'Af', 'x'.repeat(70)],
				['3,40', iban, 'Af', 'EUR'],
			],
			linesBelow: [],
			columnCount: 4,
		});

		expect(masked.columns).toEqual([
			// Ties keep the order the shapes first appear in.
			{shapes: ['99,99', '9.999,99', '', '9,99'], sameValue: false},
			{shapes: ['AA99999999999999999999'], sameValue: true},
			{shapes: ['Aa', 'Aaa'], sameValue: false},
			// No exceptions: currency codes and short values are masked too.
			{shapes: ['Aaaaaaa Aaaa', 'a'.repeat(60), 'AAA'], sameValue: false},
		]);
		expect(JSON.stringify(masked.columns)).not.toMatch(/Example|DE89|Bij|EUR|1|2|3|4|5/);
	});

	it('keeps at most six shapes of a column, the empty one always among them, and needs three rows for one value', () => {
		const masked = maskTable({
			header: null,
			linesAbove: [],
			rows: [
				...['1', '22', '333', '4444', '55555', '666666', '7777777'].flatMap((value) => [[value], [value]]),
				[''],
			],
			linesBelow: [],
			columnCount: 1,
		});
		expect(masked.columns[0].shapes).toEqual(['9', '99', '999', '9999', '99999', '']);

		const twoRows = maskTable({header: null, linesAbove: [], rows: [['X'], ['X']], linesBelow: [], columnCount: 1});
		expect(twoRows.columns).toEqual([{shapes: ['A'], sameValue: false}]);
		const threeRows = maskTable({
			header: null,
			linesAbove: [],
			rows: [['X'], [''], ['X'], ['X']],
			linesBelow: [],
			columnCount: 1,
		});
		expect(threeRows.columns).toEqual([{shapes: ['A', ''], sameValue: true}]);
	});

	it('keeps the first, middle and last rows only, the 10 lines above the table and the 3 below it', () => {
		const masked = maskTable({
			header: null,
			linesAbove: Array.from({length: 12}, (_, line) => ({line, cells: ['Example']})),
			rows: Array.from({length: 9}, (_, index) => [String(index), 'x'.repeat(index + 1)]),
			linesBelow: Array.from({length: 5}, () => ['Example']),
			columnCount: 2,
		});

		expect(masked.linesAbove.map(({line}) => line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
		expect(masked.rows).toEqual([
			['9', 'a'],
			['9', 'aaaaa'],
			['9', 'aaaaaaaaa'],
		]);
		expect(masked.linesBelow).toHaveLength(3);
	});
});

describe('sampleTable', () => {
	it('finds the table below the lines above its header, and never sends the file content but its header', () => {
		const file = fixture('debit-credit-synthetic.csv');
		const sample = sampleTable(file)!;

		expect(sample).toMatchObject({
			shape: {source: 'text', delimiter: ';', quote: '"', encoding: 'utf-8'},
			columnCount: 7,
			skipBefore: 3,
			skipAfter: 0,
			rowCount: 4,
			header: ['Buchungstag', 'Valuta', 'Auftraggeber/Empfänger', 'Verwendungszweck', 'Soll', 'Haben', 'Währung'],
		});
		expect(sample.masked.linesAbove[1]).toEqual({line: 1, cells: ['Aaaaaaaaaaa: AA99 9999 9999 9999 9999 99']});
		expect(sample.masked.rows[0]).toEqual([
			'99.99.9999',
			'99.99.9999',
			'Aaaaaaa Aaaa AaaA',
			'Aaaaaaaaaaaaa Aaaaaaa Aaaa',
			'99,99',
			'',
			'EUR',
		]);
		const sent = JSON.stringify({...sample.masked, header: null, columnShapes: null});
		for (const value of ['Example', 'Beispiel', 'Miete', '2026', '12,50', '2.500', 'DE89', '3704']) {
			expect(sent).not.toContain(value);
		}
	});

	it("never sends a short export's names as written, however often one of them repeats", () => {
		// A week of Starling card payments: a name written twice looks like a direction column.
		const sample = sampleTable(fixture('starling-short-names-synthetic.csv'))!;

		expect(sample.masked.rows.map((row) => row[1])).toEqual(['Aaaaaa Aaaa', 'Aaa Aaaa', 'Aaa Aaaaaaa']);
		expect(JSON.stringify(sample.masked)).not.toMatch(/Corner|Gym|Jan|Example|GROCERIES|CARD/);
		expect(() => validateSampleOutput({ok: true, sample})).not.toThrow();
	});

	it('takes the line right above the first row as the header, and a line of the same width above it as a line above', () => {
		const text = [
			'Owner;Example Person;NL91ABNA0417164300',
			'Date;Amount;Currency',
			'2026-03-02;-12.50;EUR',
			'2026-03-03;-4.20;EUR',
			'',
		].join('\n');
		const sample = sampleTable(Buffer.from(text));

		expect(sample).toMatchObject({
			skipBefore: 1,
			rowsAbove: 0,
			header: ['Date', 'Amount', 'Currency'],
			rowCount: 2,
		});
		expect(sample?.masked.header).toEqual(['Date', 'Amount', 'Currency']);
		expect(sample?.masked.linesAbove).toEqual([
			{line: 0, cells: ['Aaaaa', 'Aaaaaaa Aaaaaa', 'AA99AAAA9999999999']},
		]);
		expect(JSON.stringify(sample?.masked)).not.toMatch(/Example|NL91/);
	});

	it('finds no table when rows of its width follow a line of another width, which skipping would drop', () => {
		const text = [
			'Date;Amount;Currency;Note',
			'2026-03-02;-12.50;EUR;Example',
			'2026-03-03;-4.20;EUR;Example',
			'2026-03-04;-1.00;EUR;Example',
			'2026-03-05;-2.00;EUR;Example;extra',
			'2026-03-06;-3.00;EUR;Example',
			'',
		].join('\n');

		expect(sampleTable(Buffer.from(text))).toBeNull();
		// Rows of another width above the table are counted, so a layout never skips them.
		const wider = [
			'Date;Amount;Currency;Note',
			'2026-03-02;-12.50;EUR;Example;Examplestad',
			'2026-03-03;-4.20;EUR;Example;Example;Examplestad',
			'2026-03-04;-1.00;EUR;Example',
			'2026-03-05;-2.00;EUR;Example',
			'2026-03-06;-3.00;EUR;Example',
			'',
		].join('\n');
		expect(sampleTable(Buffer.from(wider))).toMatchObject({skipBefore: 3, header: null, rowCount: 3, rowsAbove: 2});
		// A footer of another width below the table is skipped as usual.
		expect(
			sampleTable(
				Buffer.from(text.replace(';extra', '').replace('2026-03-06;-3.00;EUR;Example', 'Total;-22.70')),
			),
		).toMatchObject({rowCount: 4, skipAfter: 1, rowsBelow: 0});
		// A last line cut short is counted, so a layout never skips the last row of a whole file.
		expect(sampleTable(fixture('starling-cut-last-line-synthetic.csv'))).toMatchObject({
			rowCount: 3,
			skipAfter: 1,
			rowsBelow: 1,
		});
	});

	it('finds a table padded with delimiters, and counts no padded or summary line around it as a row', () => {
		// Postbank pads every line to the table's 18 columns, the balance lines above and below it too.
		expect(sampleTable(fixture('postbank-padded-synthetic.csv'))).toMatchObject({
			columnCount: 18,
			skipBefore: 6,
			rowsAbove: 0,
			skipAfter: 1,
			rowsBelow: 0,
			rowCount: 3,
			header: expect.arrayContaining(['Buchungstag', 'Betrag', 'Währung']),
		});
		// Intesa pads empty lines too; they are no lines at all.
		expect(sampleTable(fixture('intesa-padded-synthetic.csv'))).toMatchObject({
			skipBefore: 2,
			skipAfter: 0,
			rowCount: 3,
		});
		// Sparda writes a line of values above a header of its own, and ends each row with a delimiter.
		expect(sampleTable(fixture('sparda-summary-line-synthetic.csv'))).toMatchObject({
			rowsAbove: 0,
			header: ['Buchungstag', 'Wertstellungstag', 'Verwendungszweck', 'Umsatz', 'Währung'],
			rowCount: 3,
		});
		expect(sampleTable(fixture('mbank-totals-cp1250-synthetic.csv'))).toMatchObject({rowsAbove: 0, rowCount: 3});
	});

	it('reads a sparse row at either end of the table as a row, not as padding', () => {
		const sparse = (rows: string[]) =>
			Buffer.from(['Date;Amount;Description;Category;Notes;Tags', ...rows, ''].join('\n'));
		const full = ['2026-10-05;2500.00;Salary;Income;x;y', '2026-10-07;-4.20;Cafe;Food;x;y'];
		expect(sampleTable(sparse([...full, '2026-10-09;-62.10;Energy;;;']))).toMatchObject({
			skipBefore: 0,
			skipAfter: 0,
			rowCount: 3,
		});
		expect(sampleTable(sparse(['2026-10-02;-12.50;Shop;;;', ...full]))).toMatchObject({
			skipBefore: 0,
			header: expect.arrayContaining(['Date']),
			rowCount: 3,
		});
		// A date with a four-letter month is a value too.
		const wide = (rows: string[]) => Buffer.from(['Date;Amount;Description;A;B;C;D;E', ...rows, ''].join('\n'));
		const wideRows = ['01 Sept 2026;-4.20;Cafe;a;b;c;d;e', '02 Sept 2026;-5.20;Cafe;a;b;c;d;e'];
		expect(sampleTable(wide([...wideRows, '05 Sept 2026;-12.50;Shop;;;;;']))).toMatchObject({rowCount: 3});
		expect(sampleTable(wide(['05 Sept 2026;-12.50;Shop;;;;;', ...wideRows]))).toMatchObject({rowCount: 3});
		// A last row with text in a column the rows above fill with numbers is a row all the same.
		expect(
			sampleTable(
				Buffer.from(
					'Date;Amount;Reference;Description\n2026-10-05;-4.20;12345;Cafe\n2026-10-09;-62.10;NOTPROVIDED;Energy\n',
				),
			),
		).toMatchObject({skipAfter: 0, rowCount: 2});
		// A footer of the table's width whose date cell holds a word is a line below it, not a row.
		expect(sampleTable(sparse([...full, '2026-10-09;-62.10;Energy;Home;x;y', 'Saldo;2433.40;;;;']))).toMatchObject({
			skipAfter: 1,
			rowsBelow: 0,
			rowCount: 3,
		});
	});

	it('reads windows-1250 and UTF-16 text in the encoding it is written in', () => {
		expect(sampleTable(fixture('pko-cp1250-synthetic.csv'))?.shape).toEqual({
			source: 'text',
			delimiter: ',',
			quote: '"',
			encoding: 'windows-1250',
		});
		expect(sampleTable(fixture('mbank-totals-cp1250-synthetic.csv'))?.header).toEqual([
			'#Data operacji',
			'#Opis operacji',
			'#Rachunek',
			'#Kategoria',
			'#Kwota',
			'',
		]);
		expect(sampleTable(fixture('george-utf16-synthetic.csv'))).toMatchObject({
			shape: {source: 'text', delimiter: ';', encoding: 'utf-16le'},
			header: expect.arrayContaining(['Buchungsdatum', 'Währung']),
			rowCount: 3,
		});
		// Text in windows-1252 stays so.
		expect(sampleTable(fixture('comdirect-pending-synthetic.csv'))?.shape).toMatchObject({
			encoding: 'windows-1252',
		});
	});

	it('reads a comma file with quoted decimal-comma amounts with the quote that keeps them whole', () => {
		const sample = sampleTable(fixture('headerless-direction-synthetic.csv'));

		expect(sample).toMatchObject({
			shape: {source: 'text', delimiter: ',', quote: '"'},
			columnCount: 6,
			header: null,
		});
		expect(sample?.masked.rows[0].slice(0, 4)).toEqual(['99999999', 'AA99AAAA9999999999', 'Af', '99,99']);
		expect(JSON.stringify(sample?.masked)).not.toContain('\\"');
	});

	it('masks every numeric character in the column shapes, so a superscript in any row cannot stop the sample', () => {
		const lines = fixture('headerless-direction-synthetic.csv').toString('utf8').split('\r\n');
		// Row 4 is none of the first, middle and last rows the model sees as rows.
		lines[3] = lines[3].replace(/,[^,]*$/, ',Huur 50m²');
		const sample = sampleTable(Buffer.from(lines.join('\r\n')));

		expect(sample?.masked.columns[5].shapes).toContain('Aaaa 99a9');
		expect(() => validateSampleOutput({ok: true, sample})).not.toThrow();
	});

	it('keeps the double quote for a file whose cells start with an apostrophe, as Dutch names do', () => {
		const text = [
			'2026-03-02,"\'t Hoekje","\'s-Hertogenbosch","-12,50"',
			'2026-03-03,"\'t Winkeltje","\'s-Gravenhage","-4,20"',
			'2026-03-04,"Example Shop","Example City","-1,00"',
			'',
		].join('\n');

		expect(sampleTable(Buffer.from(text))).toMatchObject({
			shape: {delimiter: ',', quote: '"'},
			columnCount: 4,
			rowCount: 3,
		});
	});

	it('finds a table without a header, and a workbook', () => {
		expect(sampleTable(fixture('headerless-synthetic.csv'))).toMatchObject({
			columnCount: 4,
			header: null,
			rowCount: 4,
			skipBefore: 0,
		});
		const workbook = createWorkbook([
			['Example statement'],
			['Date', 'Details', 'Amount'],
			[46083, 'Example Shop', -12.5],
			[46084, 'Example Employer', 2500],
		]);
		expect(sampleTable(workbook)).toMatchObject({
			shape: {source: 'xlsx'},
			columnCount: 3,
			skipBefore: 1,
			header: ['Date', 'Details', 'Amount'],
			rowCount: 2,
			masked: {
				rows: [
					['99999', 'Aaaaaaa Aaaa', '-99.9'],
					['99999', 'Aaaaaaa Aaaaaaaa', '9999'],
				],
			},
		});
	});

	it.each([
		{name: 'one line', file: Buffer.from('Date,Amount\n')},
		{name: 'text without columns', file: Buffer.from('Example notes\nmore notes\n')},
		{name: 'binary data', file: Buffer.from([0x00, 0x01, 0x2c, 0x0a, 0x00, 0x2c, 0x0a])},
	])('finds no table in $name', ({file}) => {
		expect(sampleTable(file)).toBeNull();
	});
});
