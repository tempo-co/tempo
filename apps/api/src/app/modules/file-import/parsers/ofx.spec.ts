import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parseFile} from './parse-file';
import {ParseRefusal} from './parse-result';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/file-import');
const XML_FILE = readFileSync(join(FIXTURES, 'ofx-xml-synthetic.ofx'), 'utf8');
const SGML_FILE = readFileSync(join(FIXTURES, 'ofx-sgml-synthetic.ofx'), 'latin1');
const QFX_FILE = readFileSync(join(FIXTURES, 'qfx-synthetic.qfx'), 'latin1');
const BUNQ_FILE = readFileSync(join(FIXTURES, 'bunq-nl-synthetic.csv'), 'utf8');

describe('OFX and QFX files', () => {
	it('reads the date of a date and time as written, whatever its time zone', () => {
		const file = SGML_FILE.replace('<DTPOSTED>20260303', '<DTPOSTED>20260303233000.000[-12:BIT]');

		const [statement] = parseFile(Buffer.from(file, 'latin1')).statements;

		expect(statement.rows.map(({bookingDate}) => bookingDate)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
	});

	it('reads an SGML element left empty as empty, keeping the elements after it in place', () => {
		const file = SGML_FILE.replace('<NAME>Test Persoon', '<NAME>\r\n<MEMO>Example memo').replace(
			'<BANKTRANLIST>',
			'<INTU.XID>\r\n<BANKTRANLIST>',
		);
		// The same vendor element closed in one place and left empty and unclosed in another.
		const qfx = QFX_FILE.replace('<INTU.XID>example-1', '<INTU.XID>example-1</INTU.XID>').replace(
			'<BANKTRANLIST><DTSTART>20260301120000<DTEND>20260331120000<STMTTRN><TRNTYPE>INT',
			'<INTU.XID><BANKTRANLIST><DTSTART>20260301120000<DTEND>20260331120000<STMTTRN><TRNTYPE>INT',
		);
		expect(qfx).toContain('</INTU.XID>');
		expect(qfx).toContain('<INTU.XID><BANKTRANLIST>');

		const [statement] = parseFile(Buffer.from(file, 'latin1')).statements;
		const statements = parseFile(Buffer.from(qfx, 'latin1')).statements;

		expect(statement.rows).toHaveLength(3);
		expect(statement.rows[1]).toMatchObject({counterpartyName: null, remittanceInformation: 'Example memo'});
		expect(statements.map(({rows}) => rows.length)).toEqual([2, 1]);
	});

	it('leaves a CSV file whose text mentions OFX to the CSV layouts', () => {
		const csv = BUNQ_FILE.replace('Bestelling 1001', 'Example <OFX> export');
		expect(csv).toContain('<OFX>');

		expect(parseFile(Buffer.from(csv, 'utf8'))).toMatchObject({formats: ['csv'], layouts: ['bunq-nl']});
	});

	it.each([
		{
			name: 'a statement without a currency',
			file: () => XML_FILE.replace('<CURDEF>USD</CURDEF>', ''),
			code: 'parse_failed',
		},
		{
			name: 'a document that declares entities',
			file: () =>
				XML_FILE.replace(
					'<OFX>',
					'<!DOCTYPE OFX [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><OFX>',
				).replace('Example Market', '&b;'),
			code: 'parse_failed',
		},
		{
			name: 'a document that refers to an external entity',
			file: () =>
				XML_FILE.replace(
					'<OFX>',
					'<!DOCTYPE OFX [<!ENTITY x SYSTEM "https://example.test/entity">]><OFX>',
				).replace('Example Market', '&x;'),
			code: 'parse_failed',
		},
		{
			name: 'an element closed that was never opened',
			file: () => XML_FILE.replace('</BANKTRANLIST>', '</BANKTRANLIST></STMTEND>'),
			code: 'parse_failed',
		},
		{
			name: 'a transaction list left without its end tag',
			file: () => XML_FILE.replace('</BANKTRANLIST>', ''),
			code: 'parse_failed',
		},
		{
			name: 'a document that ends before its root closes',
			file: () => XML_FILE.replace('</OFX>', ''),
			code: 'parse_failed',
		},
		{name: 'an amount that is not one', file: () => XML_FILE.replace('-42.00', '-42.00 USD'), code: 'parse_failed'},
		{
			name: 'a date that does not exist',
			file: () => XML_FILE.replace('20260302', '20260230'),
			code: 'parse_failed',
		},
		{
			name: 'an OFX file without a bank or card statement',
			file: () => XML_FILE.replace(/<BANKMSGSRSV1>[\s\S]*<\/BANKMSGSRSV1>/, ''),
			code: 'unsupported_format',
		},
	])('refuses $name with $code', ({file, code}) => {
		expect(() => parseFile(Buffer.from(file(), 'utf8'))).toThrow(new ParseRefusal(code as ParseRefusal['code']));
	});
});
