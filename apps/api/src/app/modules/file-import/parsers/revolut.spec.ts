import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {createZip} from '../../../../../test/fixtures/statement-file.fixture';
import {ParseRefusal} from './parse-result';
import {parseRevolutCsv, parseRevolutXlsx} from './revolut';
import {readZipEntries} from './zip-reader';

const FIXTURE = join(
	__dirname,
	'../../../../../test/fixtures/file-import/account-statement_2026-03-01_2026-03-05_en-gb_a0b1c2',
);
const WORKBOOK = readFileSync(`${FIXTURE}.xlsx`);
const CSV = readFileSync(`${FIXTURE}.csv`, 'utf8');

/** The fixture CSV with the line that starts with `start` replaced by `line`, or removed when `line` is null. */
function editedCsv(start: string, line: string | null): Buffer {
	const lines = CSV.split('\r\n');
	const index = lines.findIndex((candidate) => candidate.startsWith(start));
	if (index < 0) throw new Error(`no line starts with ${start}`);
	return Buffer.from(lines.toSpliced(index, 1, ...(line === null ? [] : [line])).join('\r\n'));
}

/** The fixture workbook with its first sheet's XML changed by `edit`. */
function editedWorkbook(edit: (sheet: string) => string): Buffer {
	return createZip(
		readZipEntries(WORKBOOK).map(({name, content}) => ({
			name,
			content: name === 'xl/worksheets/sheet1.xml' ? edit(content.toString('utf8')) : content,
		})),
	);
}

describe('parseRevolutCsv', () => {
	it.each([
		{
			name: 'an amount changed',
			file: editedCsv(
				'Transfer,Current,2026-03-02',
				'Transfer,Current,2026-03-02 09:00:00,2026-03-02 09:00:01,To Anna Example,-5,0,EUR,COMPLETED,141',
			),
		},
		{
			name: 'a fee removed',
			file: editedCsv(
				'Charge,',
				'Charge,Current,2026-03-02 10:00:00,2026-03-02 10:00:00,Premium plan fee,0,0,EUR,COMPLETED,133.01',
			),
		},
		{
			name: 'a completed row removed',
			file: editedCsv('Exchange,Current,2026-03-03 11:00:00,2026-03-03 11:00:00,Exchanged to RON,-20', null),
		},
		{
			name: 'a savings balance that does not follow from its rows',
			file: editedCsv(
				'Card Payment,Current,2026-03-04 8:05',
				'Transfer,Savings,2026-03-04 08:05:00,2026-03-04 08:05:00,To EUR Savings,5,0,EUR,COMPLETED,14',
			),
		},
		{
			name: 'a completed row without its balance',
			file: editedCsv(
				'Transfer,Current,2026-03-05',
				'Transfer,Current,2026-03-05 14:00:00,2026-03-05 14:00:02,"From Bram, Example",90,0,EUR,COMPLETED,',
			),
		},
		{
			name: 'a completed row marked pending with its balance kept',
			file: editedCsv(
				'Transfer,Current,2026-03-02',
				'Transfer,Current,2026-03-02 09:00:00,2026-03-02 09:00:01,To Anna Example,-50,0,EUR,PENDING,141',
			),
		},
		{
			name: 'the last completed row marked pending with its balance kept',
			file: editedCsv(
				'Card Payment,Current,2026-03-04 13:00',
				'Card Payment,Current,2026-03-04 13:00:00,2026-03-04 20:30:00,Magazin Exemplu,-15.25,0,RON,PENDING,84.25',
			),
		},
		{
			name: 'a date that does not exist',
			file: editedCsv(
				'Transfer,Current,2026-03-05',
				'Transfer,Current,2026-02-30 14:00:00,2026-03-05 14:00:02,"From Bram, Example",25,0,EUR,COMPLETED,138.01',
			),
		},
	])('refuses a statement with $name', ({file}) => {
		expect(() => parseRevolutCsv(file)).toThrow(new ParseRefusal('parse_failed'));
	});
});

describe('parseRevolutXlsx', () => {
	it.each([
		{name: 'an amount that disagrees with its stated balance', amount: '-45'},
		{name: 'a number whose exponent is out of range', amount: '1E9999999999'},
	])('refuses a workbook with $name', ({amount}) => {
		const workbook = editedWorkbook((sheet) =>
			sheet.replace('<c r="F3" s="1"><v>-4.5</v></c>', `<c r="F3" s="1"><v>${amount}</v></c>`),
		);

		expect(() => parseRevolutXlsx(workbook)).toThrow(new ParseRefusal('parse_failed'));
	});

	it('refuses a workbook with a formula instead of reading or evaluating it', () => {
		const workbook = editedWorkbook((sheet) =>
			sheet.replace('<c r="F2" s="1"><v>200</v></c>', '<c r="F2" s="1"><f>100+100</f><v>200</v></c>'),
		);

		expect(() => parseRevolutXlsx(workbook)).toThrow(new ParseRefusal('parse_failed'));
	});

	it('rounds workbook numbers to eight places from their written digits and reads an empty text balance as none', () => {
		const workbook = editedWorkbook((sheet) =>
			sheet
				.replace('<c r="F3" s="1"><v>-4.5</v></c>', '<c r="F3" s="1"><v>-4.4999999999999996</v></c>')
				.replace('<c r="F4" s="1"><v>-4.5</v></c>', '<c r="F4" s="1"><v>-4.5E0</v></c>')
				.replace('<c r="F5" s="1"><v>-50</v></c>', '<c r="F5" s="1"><v>-.5E2</v></c>')
				.replace('<c r="I9" s="1" t="s"><v>26</v></c>', '$&<c r="J9" t="inlineStr"><is><t></t></is></c>')
				.replace('<c r="J12" s="1"><v>99.5</v></c>', '<c r="J12" s="1"><v>1.0000000001E8</v></c>')
				.replace('<c r="F13" s="1"><v>-15.25</v></c>', '<c r="F13" s="1"><v>-0.01</v></c>')
				.replace('<c r="J13" s="1"><v>84.25</v></c>', '<c r="J13" s="1"><v>100000000</v></c>'),
		);

		const [euro, leu] = parseRevolutXlsx(workbook);

		expect(euro.rows[1]).toMatchObject({amount: '-4.50', balanceAfter: '195.50'});
		expect(euro.rows.at(-1)).toMatchObject({amount: '25.00', balanceAfter: '138.01'});
		expect(leu.rows.map(({amount, balanceAfter}) => [amount, balanceAfter])).toEqual([
			['99.50', '100000000.01'],
			['-0.01', '100000000.00'],
		]);
	});

	it('reads inline strings like shared ones', () => {
		const workbook = editedWorkbook((sheet) =>
			sheet.replace(
				/<c r="E3" s="1" t="s"><v>\d+<\/v><\/c>/,
				'<c r="E3" t="inlineStr"><is><t>Example Cafe</t></is></c>',
			),
		);

		expect(parseRevolutXlsx(workbook)[0].rows[1]).toMatchObject({description: 'Example Cafe', amount: '-4.50'});
	});
});
