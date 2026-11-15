import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {validateParseOutput} from '../runner/validate-parse-output';
import {parseFile} from './parse-file';
import {ParseRefusal} from './parse-result';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/file-import');
const XML_FILE = readFileSync(join(FIXTURES, 'ofx-xml-synthetic.ofx'), 'utf8');
const SGML_FILE = readFileSync(join(FIXTURES, 'ofx-sgml-synthetic.ofx'), 'latin1');
const QFX_FILE = readFileSync(join(FIXTURES, 'qfx-synthetic.qfx'), 'latin1');
const CARD_FILE = readFileSync(join(FIXTURES, 'ofx-card-synthetic.ofx'), 'latin1');
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

	it('keeps the ledger balance as the closing balance when it is dated on or after every transaction', () => {
		const ledger = (amount: string, date: string) =>
			SGML_FILE.replace('<BALAMT>1234.56\r\n<DTASOF>20260305', `<BALAMT>${amount}\r\n<DTASOF>${date}`);

		const [stated] = parseFile(Buffer.from(ledger('-1234,5', '20260305120000[-5:EST]'), 'latin1')).statements;
		const [early] = parseFile(Buffer.from(ledger('1234.56', '20260303'), 'latin1')).statements;
		const [unreadable] = parseFile(Buffer.from(ledger('1.234,56', '20260305'), 'latin1')).statements;
		const [none] = parseFile(Buffer.from(XML_FILE.replace(/<LEDGERBAL>.*<\/LEDGERBAL>/, ''))).statements;

		expect(stated).toMatchObject({openingBalance: null, closingBalance: {date: '2026-03-05', amount: '-1234.50'}});
		// A transaction is booked after it, so it may not include that one.
		expect(early.closingBalance).toBeNull();
		expect(unreadable).toMatchObject({closingBalance: null, rows: [{}, {}, {}]});
		expect(none.closingBalance).toBeNull();
	});

	it('names a bank account by its bank id, branch and account number, and an IBAN or a card by itself', () => {
		const ukAccount = (bankId: string) =>
			XML_FILE.replace(
				'<BANKID>000000000</BANKID><ACCTID>000123456789</ACCTID>',
				`<BANKID>${bankId}</BANKID><ACCTID>12345678</ACCTID>`,
			);
		const french = XML_FILE.replace('<ACCTID>', '<BRANCHID>00001</BRANCHID><ACCTID>');

		const accounts = [ukAccount('070116'), ukAccount('309634'), french, SGML_FILE, CARD_FILE].map((file) =>
			parseFile(Buffer.from(file, 'latin1')).statements.map(({accountIban, accountOtherId}) => [
				accountIban,
				accountOtherId,
			]),
		);

		// The longest ids the standard allows still pass the parent's check.
		const longest = XML_FILE.replace(
			'<BANKID>000000000</BANKID><ACCTID>000123456789</ACCTID>',
			`<BANKID>${'1'.repeat(9)}</BANKID><BRANCHID>${'2'.repeat(22)}</BRANCHID><ACCTID>${'3'.repeat(22)}</ACCTID>`,
		);
		expect(validateParseOutput({ok: true, ...parseFile(Buffer.from(longest, 'utf8'))})).toMatchObject({
			ok: true,
			result: {statements: [{accountOtherId: `${'1'.repeat(9)} ${'2'.repeat(22)} ${'3'.repeat(22)}`}]},
		});
		expect(accounts).toEqual([
			[[null, '070116 12345678']],
			[[null, '309634 12345678']],
			[[null, '000000000 00001 000123456789']],
			[['NL91ABNA0417164300', null]],
			[[null, 'EXAMPLE-CARD-0001']],
		]);
	});

	it('reads CDATA as text, and a transaction list the statement end closes', () => {
		const cdata = XML_FILE.replace(
			'<NAME>Example Market</NAME>',
			'<NAME><![CDATA[Example <!-- Market --> & Co]]></NAME>',
		);
		const unclosed = XML_FILE.replace('</BANKTRANLIST>', '');
		const unclosedSgml = SGML_FILE.replace('</BANKTRANLIST>', '');
		// An empty SGML leaf just before the list holds it until the statement's end tag.
		const unclosedAfterLeaf = unclosedSgml.replace('<BANKTRANLIST>', '<INTU.XID>\r\n<BANKTRANLIST>');

		expect(parseFile(Buffer.from(cdata, 'utf8')).statements[0].rows[0].counterpartyName).toBe(
			'Example <!-- Market --> & Co',
		);
		expect(parseFile(Buffer.from(unclosed, 'utf8')).statements).toEqual(
			parseFile(Buffer.from(XML_FILE, 'utf8')).statements,
		);
		expect(parseFile(Buffer.from(unclosedSgml, 'latin1')).statements).toEqual(
			parseFile(Buffer.from(SGML_FILE, 'latin1')).statements,
		);
		expect(parseFile(Buffer.from(unclosedAfterLeaf, 'latin1')).statements).toEqual(
			parseFile(Buffer.from(SGML_FILE, 'latin1')).statements,
		);
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
			name: 'a transaction left without its end tag',
			file: () => XML_FILE.replace('</STMTTRN>\n        </BANKTRANLIST>', '</BANKTRANLIST>'),
			code: 'parse_failed',
		},
		{
			name: 'a CDATA section that never ends',
			file: () => XML_FILE.replace('<NAME>Example Market</NAME>', '<NAME><![CDATA[Example Market</NAME>'),
			code: 'parse_failed',
		},
		{
			name: 'a comment',
			file: () => XML_FILE.replace('<NAME>Example Market</NAME>', '<!-- note --><NAME>Example Market</NAME>'),
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
