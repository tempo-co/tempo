import {camt053, createZip} from '../../../../../test/fixtures/statement-file.fixture';
import {parseFile} from './parse-file';
import {MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_UNPACKED_BYTES} from './parse-limits';
import {ParseRefusal} from './parse-result';

const statement = (reference: string, sequence: string) =>
	camt053([{sequence, entries: [{amount: '1.00', reference}]}]);

describe('parseFile', () => {
	it('reads a plain statement file', () => {
		const result = parseFile(Buffer.from(statement('A', '1')));

		expect(result).toMatchObject({format: 'camt053', files: 1, statements: [{sequenceNumber: '1'}]});
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
