import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {OTHER_EXAMPLE_IBAN} from '../../../../../test/fixtures/statement-file.fixture';
import {parseMt940} from './mt940';
import {parseFile} from './parse-file';
import {NormalizedRow, ParseRefusal} from './parse-result';

const ABN_AMRO_FILE = readFileSync(join(__dirname, '../../../../../test/fixtures/file-import/MT940260305120000.STA'));

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
				accountCurrency: 'EUR',
				sequenceNumber: '12',
				entriesSkipped: 0,
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
						counterpartyName: 'Example Shop',
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
				description:
					'/EREF/E2E-EXAMPLE-2//CNTP/NL20INGB0001234567/INGBNL2A/Example Employer/AMSTERDAM//REMI/USTD//Salary October 2026/',
				referenceNumber: 'E2E-EXAMPLE-2',
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
				description:
					'/EREF/NOTPROVIDED/BENM//NAME/Example Housing/REMI/Rent October 2026 contract 4711 apartment 3B/ISDT/2026-10-05',
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
				description: '/ORDP//NAME/Example Sender/ADDR/Example Street 1/REMI/Gift/',
				referenceNumber: null,
			},
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
			name: 'free text on one line, which names no counterparty',
			information: [':86:Account fee October'],
			expected: {
				counterpartyName: null,
				counterpartyIban: null,
				remittanceInformation: null,
				description: 'Account fee October',
				referenceNumber: null,
			},
		},
	])('reads the payee from $name', ({information, entryDetails, expected}) => {
		const entry = [':61:2610051005C10,00NTRFNONREF//B1', ...(entryDetails ? [entryDetails] : []), ...information];

		const row = only(statement(entry, '110,00'), 'utf8');

		expect(row).toMatchObject(expected);
	});

	it('reads a UTF-8 file as UTF-8 and any other as latin-1', () => {
		const file = statement([':61:2610051005D10,00NTRFNONREF//B1', ':86:166?00GUTSCHRIFT?32Jörg Müller'], '90,00');

		expect(only(file, 'utf8').counterpartyName).toBe('Jörg Müller');
		expect(only(file, 'latin1').counterpartyName).toBe('Jörg Müller');
		expect(parseFile(Buffer.from(`\uFEFF${file}`, 'utf8')).statements[0].rows[0].counterpartyName).toBe('Jörg Müller');
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
			expected: {valueDate: '2026-10-05', bookingDate: '2026-10-06', referenceNumber: 'KREF-1', bankReference: 'B1'},
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
	])('refuses $name', ({file}) => {
		expect(() => parseMt940(Buffer.from(file, 'latin1'))).toThrow(new ParseRefusal('parse_failed'));
	});
});
