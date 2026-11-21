import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {OTHER_EXAMPLE_IBAN} from '../../../../../test/fixtures/statement-file.fixture';
import {parseMt940} from './mt940';
import {parseFile} from './parse-file';
import {NormalizedRow, ParseRefusal} from './parse-result';

/** A synthetic Polish IBAN. */
const POLISH_IBAN = 'PL4910900000000000000000001234';
const FIXTURES = join(__dirname, '../../../../../test/fixtures/file-import');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const ABN_AMRO_FILE = fixture('MT940260305120000.STA');

/** One statement of another bank: opening 100.00 on 2026-10-05, the given entries, closing at the running total. */
const statement = (entries: string[], closing: string, header: string[] = []) =>
	[
		...header,
		':20:EXAMPLE',
		`:25:${OTHER_EXAMPLE_IBAN}`,
		':28C:00001/001',
		':60F:C261005EUR100,00',
		...entries,
		`:62F:C261031EUR${closing}`,
		'-',
	].join('\r\n');

const only = (file: string, encoding: BufferEncoding = 'latin1'): NormalizedRow => {
	const [{rows}] = parseMt940(Buffer.from(file, encoding));
	expect(rows).toHaveLength(1);
	return rows[0];
};

describe('parseMt940', () => {
	it("reads another bank's statement: IBAN and currency in :25:, the entry date as booking date, both references", () => {
		const file = [
			':20:EXAMPLE',
			`:25:${OTHER_EXAMPLE_IBAN}EUR`,
			':28C:00012/001',
			':60F:C260227EUR100,00',
			':61:2603020301D12,5NTRFREF-1//BANKREF-1',
			':86:Example Shop',
			'card payment',
			':62F:C260302EUR87,50',
			'-',
		].join('\r\n');

		expect(parseMt940(Buffer.from(file, 'latin1'))).toEqual([
			{
				format: 'mt940',
				layout: null,
				accountIban: OTHER_EXAMPLE_IBAN,
				accountOtherId: null,
				bank: null,
				servicerBic: null,
				accountCurrency: 'EUR',
				sequenceNumber: '12',
				entriesSkipped: 0,
				openingBalance: {date: '2026-02-27', amount: '100.00'},
				closingBalance: {date: '2026-03-02', amount: '87.50'},
				rows: [
					{
						bookingDate: '2026-03-01',
						valueDate: '2026-03-02',
						transactionDate: null,
						amount: '-12.50',
						creditDebitIndicator: 'DBIT',
						currency: 'EUR',
						balanceAfter: '87.50',
						bankReference: 'BANKREF-1',
						// Free text in no known layout names no payee.
						counterpartyName: null,
						counterpartyIban: null,
						remittanceInformation: null,
						description: 'Example Shop card payment',
						bankTransactionCode: null,
						bankTransactionSubCode: null,
						referenceNumber: 'REF-1',
					},
				],
			},
		]);
	});

	it.each([
		{
			name: 'German ?nn subfields: name in ?32 and ?33, IBAN in ?31, purpose in ?20 to ?29 joined where a subfield is full',
			information: [
				// ?21, ?22 and ?32 are full (27 characters) and end mid-word; ?20 is not, so a space follows it.
				':86:166?00GUTSCHR. UEBERWEISUNG?10931?20EREF+E2E-EXAMPLE-1?21SVWZ+Invoice 4711 for the e',
				'?22xample consulting work in O?23ctober?31DE75512108001245126199',
				'?32Jörg Müller Example Consult?33ing GmbH?34000',
			],
			expected: {
				counterpartyName: 'Jörg Müller Example Consulting GmbH',
				counterpartyIban: 'DE75512108001245126199',
				remittanceInformation: 'Invoice 4711 for the example consulting work in October',
				description:
					'GUTSCHR. UEBERWEISUNG EREF+E2E-EXAMPLE-1 SVWZ+Invoice 4711 for the example consulting work in October',
				referenceNumber: 'E2E-EXAMPLE-1',
			},
		},
		{
			name: 'German subfields after another separator, with purpose text and no SEPA keywords',
			information: [':86:020>00Example posting>20Membership fee 2026>32Example Club'],
			expected: {
				counterpartyName: 'Example Club',
				counterpartyIban: null,
				remittanceInformation: 'Membership fee 2026',
				description: 'Example posting Membership fee 2026',
				referenceNumber: null,
			},
		},
		{
			name: 'SWIFT /CNTP/ and /REMI/USTD// codes wrapped at the line end mid-word',
			information: [
				':86:/EREF/E2E-EXAMPLE-2//CNTP/NL20INGB0001234567/INGBNL2A/Example Emplo',
				'yer/AMSTERDAM//REMI/USTD//Salary October 2026/',
			],
			expected: {
				counterpartyName: 'Example Employer',
				counterpartyIban: 'NL20INGB0001234567',
				remittanceInformation: 'Salary October 2026',
				description: 'E2E-EXAMPLE-2 NL20INGB0001234567 INGBNL2A Example Employer AMSTERDAM Salary October 2026',
				referenceNumber: 'E2E-EXAMPLE-2',
			},
		},
		{
			name: 'SWIFT /CNTP/ without an account or BIC',
			information: [':86:/EREF/E2E-EXAMPLE-3//CNTP///Example Shop/EXAMPLE CITY//REMI/USTD//Card payment/'],
			expected: {
				counterpartyName: 'Example Shop',
				counterpartyIban: null,
				remittanceInformation: 'Card payment',
				description: 'E2E-EXAMPLE-3 Example Shop EXAMPLE CITY Card payment',
				referenceNumber: 'E2E-EXAMPLE-3',
			},
		},
		{
			name: 'SWIFT /BENM//NAME/ and /REMI/ codes, the counterparty account on the entry line after the amount',
			entryDetails: 'NL20INGB0001234567',
			information: [
				':86:/EREF/NOTPROVIDED/BENM//NAME/Example Housing/REMI/Rent October 2026 contract 4711 apart',
				'ment 3B/ISDT/2026-10-05',
			],
			expected: {
				counterpartyName: 'Example Housing',
				counterpartyIban: 'NL20INGB0001234567',
				remittanceInformation: 'Rent October 2026 contract 4711 apartment 3B',
				description: 'Example Housing Rent October 2026 contract 4711 apartment 3B 2026-10-05',
				referenceNumber: null,
			},
		},
		{
			name: 'SWIFT /ORDP//NAME/ with an address',
			information: [':86:/ORDP//NAME/Example Sender/ADDR/Example Street 1/REMI/Gift/'],
			expected: {
				counterpartyName: 'Example Sender',
				counterpartyIban: null,
				remittanceInformation: 'Gift',
				description: 'Example Sender Example Street 1 Gift',
				referenceNumber: null,
			},
		},
		{
			name: 'SWIFT /ORDP/name?city on a credit, with the account in /BENM/',
			information: [':86:/REMI/0056696/ORDP/Example Company AB?EXAMPLE CITY/BENM/56785678'],
			expected: {
				counterpartyName: 'Example Company AB',
				counterpartyIban: null,
				remittanceInformation: '0056696',
				description: '0056696 Example Company AB?EXAMPLE CITY 56785678',
				referenceNumber: null,
			},
		},
		{
			name: 'SWIFT codes in a field that starts with a code without its slash',
			information: [':86:REMI/57700?+719,00/ORDP/Example Company AB?EXAMPLE CITY'],
			expected: {
				counterpartyName: 'Example Company AB',
				remittanceInformation: '57700?+719,00',
				description: '57700?+719,00 Example Company AB?EXAMPLE CITY',
			},
		},
		{
			name: 'SWIFT /BENM/name?account on a debit',
			debit: true,
			information: [':86:/REMI/INVOICE 117777/ORDP/Example Owner AB/BENM/Example Supplier AB?2777006'],
			expected: {
				counterpartyName: 'Example Supplier AB',
				remittanceInformation: 'INVOICE 117777',
				description: 'INVOICE 117777 Example Owner AB Example Supplier AB?2777006',
			},
		},
		{
			name: 'two :86: fields, the second with ~nn subfields',
			information: [':86:303', ':86:303~00B303PRZELEW WEWNETRZNY~20ZASILENIE RACHUNKU~32EXAMPLE PAYEE'],
			expected: {
				counterpartyName: 'EXAMPLE PAYEE',
				remittanceInformation: 'ZASILENIE RACHUNKU',
				description: '303 B303PRZELEW WEWNETRZNY ZASILENIE RACHUNKU',
			},
		},
		{
			name: 'the Polish DLA: keyword on a debit, its value wrapped onto the next line',
			debit: true,
			information: [
				':86:944 PRZELEW KRAJOWY; NA RACH.: 12100000000000000000001234; ',
				'DLA: EXAMPLE SHOP SP. Z O.O. EXAMPLE STREET 1 ',
				'00-001 EXAMPLE CITY; OD: EXAMPLE OWNER; TYT.: FV 100/2026',
			],
			expected: {
				counterpartyName: 'EXAMPLE SHOP SP. Z O.O. EXAMPLE STREET 1 00-001 EXAMPLE CITY',
				counterpartyIban: null,
				remittanceInformation: null,
				description:
					'944 PRZELEW KRAJOWY; NA RACH.: 12100000000000000000001234; DLA: EXAMPLE SHOP SP. Z O.O. EXAMPLE STREET 1 00-001 EXAMPLE CITY; OD: EXAMPLE OWNER; TYT.: FV 100/2026',
			},
		},
		{
			name: 'the Polish OD: keyword on a credit',
			information: [':86:943 PRZELEW KRAJOWY; DLA: EXAMPLE OWNER; OD: EXAMPLE SENDER; TYT.: ZWROT'],
			expected: {counterpartyName: 'EXAMPLE SENDER'},
		},
		{
			name: 'the Polish Nadawca: keyword on a credit',
			information: [
				':86:UZNANIE;Numer ref:2234567;Rachunek nadawcy:',
				'11100000000000000000000000;Nadawca:EXAMPLE SENDER SP Z O.O. EXAMPLE',
				'CITY;Adresat:EXAMPLE OWNER;Tytul: Example title;',
			],
			expected: {counterpartyName: 'EXAMPLE SENDER SP Z O.O. EXAMPLE CITY'},
		},
		{
			name: 'the Polish Odbiorca: keyword on a debit',
			debit: true,
			information: [':86:OBCIAZENIE;Numer ref:1234567;Odbiorca:EXAMPLE PAYEE SP. Z O.O.;Tytul:Example title;'],
			expected: {counterpartyName: 'EXAMPLE PAYEE SP. Z O.O.'},
		},
		{
			name: 'the Polish OD: keyword on a debit, where it names the account holder',
			debit: true,
			information: [':86:944 PRZELEW KRAJOWY; OD: EXAMPLE OWNER; TYT.: EXAMPLE'],
			expected: {counterpartyName: null},
		},
		{
			name: 'free text with an account and the name on the first line',
			information: [':86:NL20INGB0001234567 Example Payee', 'Monthly contribution'],
			expected: {
				counterpartyName: 'Example Payee',
				counterpartyIban: 'NL20INGB0001234567',
				remittanceInformation: null,
				description: 'NL20INGB0001234567 Example Payee Monthly contribution',
				referenceNumber: null,
			},
		},
		{
			name: 'free text in no known layout, which names no counterparty',
			information: [':86:Transfer to: Example card', 'Card account 1234', '00000000000011234 Example name'],
			expected: {
				counterpartyName: null,
				counterpartyIban: null,
				remittanceInformation: null,
				description: 'Transfer to: Example card Card account 1234 00000000000011234 Example name',
				referenceNumber: null,
			},
		},
	])('reads the payee from $name', ({information, entryDetails, debit, expected}) => {
		const entry = [
			`:61:2610051005${debit ? 'D' : 'C'}10,00NTRFNONREF//B1`,
			...(entryDetails ? [entryDetails] : []),
			...information,
		];

		const row = only(statement(entry, debit ? '90,00' : '110,00'), 'utf8');

		expect(row).toMatchObject(expected);
	});

	it.each([
		{
			name: "Handelsbanken's single-slash /ORDP/ and /BENM/ codes",
			file: 'handelsbanken-ordp-benm-mt940-synthetic.sta',
			accountIban: 'SE4550000000058398257466',
			expected: [
				{counterpartyName: 'EXAMPLE COMPANY ONE AB', remittanceInformation: '57700?+719,00'},
				{counterpartyName: 'EXAMPLE COMPANY TWO AB', remittanceInformation: '0056696'},
				{counterpartyName: 'EXAMPLE SUPPLIER AB', remittanceInformation: 'INVOICE 117777', amount: '-841.00'},
			],
		},
		{
			name: "mBank's second :86: field, after an account written with a slash",
			file: 'mbank-retail-second-86-mt940-synthetic.sta',
			accountIban: 'PL61109010140000071219812874',
			expected: [
				{
					counterpartyName: 'EXAMPLE PAYEE NAME',
					remittanceInformation: 'ZASILENIE RACHUNKU',
					description: '303 B303PRZELEW WEWNETRZNY WYCH ZASILENIE RACHUNKU',
				},
			],
		},
		{
			name: "Santander Bank Polska's Odbiorca: and Nadawca: keywords",
			file: 'santander-pl-keywords-mt940-synthetic.sta',
			accountIban: 'PL61109010140000071219812874',
			expected: [
				{counterpartyName: 'EXAMPLE PAYEE SP. Z O.O. EXAMPLE CITY', amount: '-50.00'},
				{counterpartyName: 'EXAMPLE SENDER SP Z O.O. EXAMPLE TOWN', amount: '100.00'},
			],
		},
		{
			name: "mBank's DLA: and OD: keywords in Windows-1250",
			file: 'mbank-cp1250-mt940-synthetic.sta',
			accountIban: 'PL61109010140000071219812874',
			expected: [
				{counterpartyName: 'ŁÓDZKA SPÓŁKA PRZYKŁADOWA ŚWIĘTOKRZYSKA 1 00-001 ŹRÓDŁO', amount: '-25.00'},
				{counterpartyName: 'ŻANETA PRZYKŁAD UL. ŻÓŁTA 2 00-002 ŁĘCZYCA', amount: '40.00'},
			],
		},
	])('reads the payees of a file in the shape of $name', ({file, accountIban, expected}) => {
		const [statement] = parseFile(fixture(file)).statements;

		expect(statement.accountIban).toBe(accountIban);
		expect(statement.rows).toMatchObject(expected);
	});

	it('reads a UTF-8 file as UTF-8, any other as Windows-1252, and a Central European account in its own encoding', () => {
		const file = statement(
			[':61:2610051005D10,00NTRFNONREF//B1', ':86:166?00GUTSCHRIFT?20Fee 10 \x80?32Jörg Müller'],
			'90,00',
		);
		// ŁÓDŹ ŚLĄSK ŻÓŁTA in Windows-1250 and in ISO-8859-2, for an account the IBAN places in Poland.
		const polish = (name: number[]) =>
			Buffer.concat([
				Buffer.from(
					[
						':20:EXAMPLE',
						`:25:/${POLISH_IBAN}`,
						':60F:C261005PLN100,00',
						':61:2610051005D10,00NTRFNONREF//B1',
						':86:944 PRZELEW KRAJOWY; DLA: ',
					].join('\r\n'),
					'latin1',
				),
				Buffer.from(name),
				Buffer.from(['; TYT.: EXAMPLE', ':62F:C261005PLN90,00', '-'].join('\r\n'), 'latin1'),
			]);
		const windows1250 = [
			0xa3, 0xd3, 0x44, 0x8f, 0x20, 0x8c, 0x4c, 0xa5, 0x53, 0x4b, 0x20, 0xaf, 0xd3, 0xa3, 0x54, 0x41,
		];
		const iso88592 = [
			0xa3, 0xd3, 0x44, 0xac, 0x20, 0xa6, 0x4c, 0xa1, 0x53, 0x4b, 0x20, 0xaf, 0xd3, 0xa3, 0x54, 0x41,
		];

		expect(only(file, 'utf8')).toMatchObject({
			counterpartyName: 'Jörg Müller',
			remittanceInformation: 'Fee 10 \x80',
		});
		expect(only(file, 'latin1')).toMatchObject({
			counterpartyName: 'Jörg Müller',
			remittanceInformation: 'Fee 10 €',
		});
		expect(parseFile(Buffer.from(`\uFEFF${file}`, 'utf8')).statements[0].rows[0].counterpartyName).toBe(
			'Jörg Müller',
		);
		for (const bytes of [windows1250, iso88592]) {
			const [parsed] = parseMt940(polish(bytes));
			expect(parsed).toMatchObject({accountIban: POLISH_IBAN, rows: [{counterpartyName: 'ŁÓDŹ ŚLĄSK ŻÓŁTA'}]});
		}
		const utf8 = Buffer.from(
			polish(windows1250)
				.toString('latin1')
				.replace(/DLA: [^;]*/, 'DLA: ŁÓDŹ'),
			'utf8',
		);
		expect(parseMt940(utf8)[0].rows[0].counterpartyName).toBe('ŁÓDŹ');
	});

	it("dates a balance on the 29th to 31st of a shorter month, as 30/360 interest statements do, on that month's last day", () => {
		const [statement] = parseMt940(fixture('nov-31-balance-mt940-synthetic.sta'));

		expect(statement).toMatchObject({
			closingBalance: {date: '2026-11-30', amount: '105.00'},
			rows: [{valueDate: '2026-11-30', amount: '5.00', balanceAfter: '105.00'}],
		});
	});

	it.each([
		{
			name: 'a 30 February value date, as on 30/360 closing entries',
			entry: ':61:2602300301D10,00N805NONREF',
			expected: {valueDate: '2026-02-28', bookingDate: '2026-03-01'},
		},
		{
			name: 'a two-letter transaction type padded with a space',
			entry: ':61:261005D10,00NIT NONREF',
			expected: {valueDate: '2026-10-05', bookingDate: '2026-10-05', referenceNumber: null},
		},
		{
			name: 'a space between the amount and the transaction type',
			entry: ':61:2610051006D10,00 NRTIKREF-1//B1',
			expected: {
				valueDate: '2026-10-05',
				bookingDate: '2026-10-06',
				referenceNumber: 'KREF-1',
				bankReference: 'B1',
			},
		},
		{
			name: 'spaces where the entry date goes',
			entry: ':61:261005    D10,00NOVBNONREF',
			expected: {valueDate: '2026-10-05', bookingDate: '2026-10-05'},
		},
		{
			name: 'no entry date, booked on its value date',
			entry: ':61:261015D10,00NTRFNONREF',
			expected: {valueDate: '2026-10-15', bookingDate: '2026-10-15'},
		},
	])('reads an entry with $name', ({entry, expected}) => {
		const row = only(statement([entry, ':86:Example Shop'], '90,00'));

		expect(row).toMatchObject({amount: '-10.00', balanceAfter: '90.00', ...expected});
	});

	it.each([
		['a SWIFT basic header', ['{1:F01EXMPDEFFAXXX0000000000}{2:I940EXMPDEFFXXXXN}{4:'], 'EXMPDEFF'],
		[
			'the sender in the application header of an output message',
			['{1:F01RCVRNL2AAXXX0000000000}{2:O9401200261005EXMPDEFFAXXX00000000002610051200N}{4:'],
			'EXMPDEFF',
		],
		["a header of the sender's BIC over the message type", ['EXMPDEFF', '940', 'EXMPDEFF'], 'EXMPDEFF'],
		['a header naming no BIC', ['EXAMPLEBANK'], null],
		['no header', [], null],
	])("reads the bank's BIC from %s", (_caseName, header, servicerBic) => {
		const [parsed] = parseMt940(
			Buffer.from(statement([':61:261005D10,00NTRFNONREF', ':86:Example Shop'], '90,00', header), 'latin1'),
		);

		expect(parsed.servicerBic).toBe(servicerBic);
	});

	it('finds the statement after blank lines and a header', () => {
		const file = statement([':61:261005D10,00NTRFNONREF', ':86:Example Shop'], '90,00', [
			'',
			'',
			'',
			'',
			'',
			'',
			'EXAMPLEBANK',
		]);

		expect(parseFile(Buffer.from(file, 'latin1'))).toMatchObject({formats: ['mt940'], statements: [{rows: [{}]}]});
	});

	it.each([
		{
			name: "ABN AMRO's statement with its closing balance changed",
			file: ABN_AMRO_FILE.toString('latin1').replace(':62F:C260302EUR2637,50', ':62F:C260302EUR2637,51'),
		},
		{
			name: "another bank's statement with an amount changed",
			file: statement([':61:2610051006D10,01 NRTIKREF-1//B1', ':86:Example Shop'], '90,00'),
		},
		{
			name: 'a value date on a day no month has',
			file: statement([':61:2602320301D10,00N805NONREF'], '90,00'),
		},
		{
			name: 'a file that ends inside the available balance after the closing balance',
			file: fixture('cut-available-balance-mt940-synthetic.sta').toString('latin1'),
		},
	])('refuses $name', ({file}) => {
		expect(() => parseMt940(Buffer.from(file, 'latin1'))).toThrow(new ParseRefusal('parse_failed'));
	});
});
