import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {createWorkbook} from '../../../../../test/fixtures/statement-file.fixture';
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

	it('sends header cells, currency codes and the few repeated short values of a column as written', () => {
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
		});
	});

	it.each([
		{name: 'no value written twice', column: ['Jan Example', 'Example Shop', 'Example Bar']},
		{name: 'a value with a digit', column: ['Example 1', 'Example 1', 'Example 1']},
		{name: 'a value over 12 characters', column: ['Example Lender', 'Example Lender', 'Example Lender']},
		{name: 'more than four values', column: ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E']},
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

	it('sends a direction column as written when one of its values repeats, however often the other is written', () => {
		const masked = maskTable({
			header: null,
			linesAbove: [],
			rows: [['D'], ['C'], ['D']],
			linesBelow: [],
			columnCount: 1,
		});

		expect(masked.rows).toEqual([['D'], ['C'], ['D']]);
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

	it('takes the line right above the first row as the header, and a line of the same width above it as a line above', () => {
		const text = [
			'Owner;Example Person;NL91ABNA0417164300',
			'Date;Amount;Currency',
			'2026-03-02;-12.50;EUR',
			'2026-03-03;-4.20;EUR',
			'',
		].join('\n');
		const sample = sampleTable(Buffer.from(text));

		expect(sample).toMatchObject({skipBefore: 1, header: ['Date', 'Amount', 'Currency'], rowCount: 2});
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
		// A footer of another width below the table is skipped as usual.
		expect(
			sampleTable(
				Buffer.from(text.replace(';extra', '').replace('2026-03-06;-3.00;EUR;Example', 'Total;-22.70')),
			),
		).toMatchObject({rowCount: 4, skipAfter: 1});
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
