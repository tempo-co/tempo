import {readFileSync} from 'node:fs';
import {join} from 'node:path';

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
function refusal(text: string): {code: string; layout: string | null} {
	try {
		parseFile(file(text));
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
	])('leaves an ASN Bank file with $change unclaimed, since the export has no header', ({from, to}) => {
		const text = fixture('asn-synthetic.csv');
		expect(text).toMatch(from);

		expect(refusal(text.replace(from, to))).toEqual({code: 'unsupported_format', layout: null});
	});

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
