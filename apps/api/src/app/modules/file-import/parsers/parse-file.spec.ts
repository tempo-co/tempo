import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {camt053, createZip} from '../../../../../test/fixtures/statement-file.fixture';
import {parseFile} from './parse-file';
import {MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_UNPACKED_BYTES} from './parse-limits';
import {NormalizedStatement, ParseRefusal, StatementFormat} from './parse-result';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/file-import');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
// The normalized statements each synthetic export must parse to, without the format and bank fields, and without
// the layout field outside the bank CSV exports.
const EXPECTED = JSON.parse(fixture('expected.json').toString('utf8')) as Record<
	string,
	{
		format: StatementFormat;
		statements: (Omit<NormalizedStatement, 'format' | 'bank' | 'layout'> & {layout?: string | null})[];
	}
>;

const statement = (reference: string, sequence: string) =>
	camt053([{sequence, entries: [{amount: '1.00', reference}]}]);

describe('parseFile', () => {
	it('reads a plain statement file', () => {
		const result = parseFile(Buffer.from(statement('A', '1')));

		expect(result).toMatchObject({files: 1, formats: ['camt053'], statements: [{sequenceNumber: '1'}]});
	});

	it.each(Object.entries(EXPECTED))('recognizes %s by its content and reads it field by field', (name, expected) => {
		const result = parseFile(fixture(name));

		expect(result).toEqual({
			files: 1,
			formats: [expected.format],
			layouts: expected.format === 'csv' ? [expected.statements[0].layout] : [],
			statements: expected.statements.map((statement) => ({
				layout: null,
				...statement,
				format: expected.format,
				bank: expected.format.startsWith('revolut') ? 'Revolut' : null,
			})),
		});
	});

	it('reads an archive holding statements in several formats', () => {
		const archive = createZip([
			{name: 'a', content: fixture('MT940260305120000.STA')},
			{name: 'b', content: fixture('0417164300_99999999_050326000000.xml')},
			{name: 'c', content: fixture('TXT260305120000.TAB')},
			{name: 'd', content: fixture('account-statement_2026-03-01_2026-03-05_en-gb_a0b1c2.csv')},
		]);

		const result = parseFile(archive);

		expect(result.files).toBe(4);
		expect(result.formats).toEqual(['mt940', 'camt053', 'abnAmroTxt', 'revolutCsv']);
		expect(result.statements.map(({format}) => format)).toEqual([
			'mt940',
			'mt940',
			'mt940',
			'camt053',
			'abnAmroTxt',
			'revolutCsv',
			'revolutCsv',
		]);
	});

	it('unpacks an archive one level, skipping directories, whatever the entries are called', () => {
		const archive = createZip([
			{name: 'statements/', content: ''},
			{name: '../../outside.xml', content: statement('A', '1')},
			{name: 'no-extension', content: statement('B', '2'), method: 0},
		]);

		const result = parseFile(archive);

		expect(result.files).toBe(2);
		expect(result.statements.map(({rows}) => rows[0].bankReference)).toEqual(['A', 'B']);
	});

	it.each([
		{name: 'plain text', file: () => Buffer.from('Date,Amount\n2026-03-02,1.00\n'), code: 'unsupported_format'},
		{
			name: 'XML that is not a statement',
			file: () => Buffer.from('<?xml version="1.0"?><Invoice/>'),
			code: 'unsupported_format',
		},
		{
			name: 'tab-separated text that is not an ABN AMRO export',
			file: () =>
				Buffer.from(
					`${['Example', 'EUR', '20260302', '1,00', '2,00', '20260302', '1,00', 'Example'].join('\t')}\r\n`,
				),
			code: 'unsupported_format',
		},
		{
			name: 'an old binary Excel file',
			file: () => Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504)]),
			code: 'legacy_xls_not_supported',
		},
		{
			name: 'an archive holding an old binary Excel file',
			file: () =>
				createZip([
					{name: 'a', content: Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(8)])},
				]),
			code: 'legacy_xls_not_supported',
		},
		{
			name: 'a workbook whose first row is not the Revolut header',
			file: () =>
				createZip([
					{
						name: 'xl/workbook.xml',
						content:
							'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Example" sheetId="1" r:id="rId1"/></sheets></workbook>',
					},
					{
						name: 'xl/_rels/workbook.xml.rels',
						content:
							'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
					},
					{
						name: 'xl/worksheets/sheet1.xml',
						content:
							'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row></sheetData></worksheet>',
					},
				]),
			code: 'unsupported_format',
		},
		{
			name: 'an archive holding a workbook',
			file: () =>
				createZip([
					{name: 'a.xlsx', content: fixture('account-statement_2026-03-01_2026-03-05_en-gb_a0b1c2.xlsx')},
				]),
			code: 'unsupported_format',
		},
		{name: 'an empty archive', file: () => createZip([]), code: 'unsupported_format'},
		{
			name: 'an archive holding an archive',
			file: () =>
				createZip([{name: 'inner.zip', content: createZip([{name: 'a.xml', content: statement('A', '1')}])}]),
			code: 'unsupported_format',
		},
		{
			name: 'an archive with one entry that is not a statement',
			file: () =>
				createZip([
					{name: 'a.xml', content: statement('A', '1')},
					{name: 'readme.txt', content: 'Example notes'},
				]),
			code: 'unsupported_format',
		},
		{
			name: 'a zip bomb whose entry claims to be small',
			file: () =>
				createZip([
					{name: 'a.xml', content: Buffer.alloc(MAX_ARCHIVE_UNPACKED_BYTES + 1, 0x20), declaredSize: 100},
				]),
			code: 'archive_too_large',
		},
		{
			name: 'entries that are each small but together unpack past the limit',
			file: () =>
				createZip(
					Array.from({length: 3}, (_, index) => ({
						name: `${index}.xml`,
						content: Buffer.alloc(MAX_ARCHIVE_UNPACKED_BYTES / 2, 0x20),
					})),
				),
			code: 'archive_too_large',
		},
		{
			name: 'more entries than an archive may hold',
			file: () =>
				createZip(
					Array.from({length: MAX_ARCHIVE_ENTRIES + 1}, (_, index) => ({name: `${index}`, content: ''})),
				),
			code: 'too_many_files',
		},
		{
			name: 'an entry whose checksum does not match',
			file: () => createZip([{name: 'a.xml', content: statement('A', '1'), crc: 1}]),
			code: 'parse_failed',
		},
		{
			name: 'a truncated archive',
			file: () => createZip([{name: 'a.xml', content: statement('A', '1')}]).subarray(0, 60),
			code: 'parse_failed',
		},
	])('refuses $name with $code', ({file, code}) => {
		expect(() => parseFile(file())).toThrow(new ParseRefusal(code as ParseRefusal['code']));
	});
});
