import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {EXAMPLE_IBAN, camt053} from '../../../../../test/fixtures/statement-file.fixture';
import {parseCamt053} from './camt053';
import {parseFile} from './parse-file';
import {NormalizedRow, ParseRefusal} from './parse-result';

const parse = (xml: string) => parseCamt053(Buffer.from(xml));
const SWISS_FILE = readFileSync(
	join(__dirname, '../../../../../test/fixtures/file-import/swiss-zone-dates-camt-synthetic.xml'),
	'utf8',
);

const counterpartyDetails = (party: 'Cdtr' | 'Dbtr', name: string, iban: string, extra = '') =>
	`<TxDtls><Refs><EndToEndId>E2E-EXAMPLE</EndToEndId></Refs><RltdPties><${party}><Nm>${name}</Nm></${party}>` +
	`<${party}Acct><Id><IBAN>${iban}</IBAN></Id></${party}Acct></RltdPties>${extra}</TxDtls>`;

const row = (overrides: Partial<NormalizedRow>): NormalizedRow => ({
	bookingDate: '2026-03-02',
	valueDate: '2026-03-02',
	transactionDate: null,
	amount: '-1.00',
	creditDebitIndicator: 'DBIT',
	currency: 'EUR',
	balanceAfter: null,
	bankReference: null,
	counterpartyName: null,
	counterpartyIban: null,
	remittanceInformation: null,
	description: null,
	bankTransactionCode: 'CCRD',
	bankTransactionSubCode: 'POSD',
	referenceNumber: null,
	...overrides,
});

describe('parseCamt053', () => {
	it.each([
		{
			name: 'a card payment without details takes its text from AddtlNtryInf',
			entry: {amount: '12.50', reference: 'REF-1', info: 'Example Shop card payment', valueDate: '2026-03-01'},
			expected: row({
				amount: '-12.50',
				valueDate: '2026-03-01',
				bankReference: 'REF-1',
				description: 'Example Shop card payment',
			}),
		},
		{
			name: 'a debit names the creditor as counterparty and keeps its end-to-end id',
			entry: {
				amount: '850.00',
				details: counterpartyDetails(
					'Cdtr',
					'Example Landlord',
					'NL44 RABO 0123 4567 89',
					'<RmtInf><Ustrd>Rent</Ustrd><Ustrd>March</Ustrd></RmtInf>',
				),
			},
			expected: row({
				amount: '-850.00',
				counterpartyName: 'Example Landlord',
				counterpartyIban: 'NL44RABO0123456789',
				remittanceInformation: 'Rent March',
				referenceNumber: 'E2E-EXAMPLE',
			}),
		},
		{
			name: 'a credit names the debtor and decodes standard entities',
			entry: {
				amount: '2500.00',
				indicator: 'CRDT' as const,
				details: counterpartyDetails(
					'Dbtr',
					'Example Employer',
					'NL39RABO0300065264',
					'<RmtInf><Ustrd>Salary &amp; bonus</Ustrd></RmtInf>',
				),
			},
			expected: row({
				amount: '2500.00',
				creditDebitIndicator: 'CRDT',
				counterpartyName: 'Example Employer',
				counterpartyIban: 'NL39RABO0300065264',
				remittanceInformation: 'Salary & bonus',
				referenceNumber: 'E2E-EXAMPLE',
			}),
		},
		{
			name: 'an amount without a leading zero and dates with a time zone, read as written',
			entry: {amount: '.21', bookingDate: '2026-03-02+01:00', valueDate: '2026-03-01Z'},
			expected: row({amount: '-0.21', valueDate: '2026-03-01'}),
		},
		{
			name: 'NOTPROVIDED is no reference number',
			entry: {
				amount: '5.00',
				details:
					'<TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs><RltdPties><Cdtr><Nm>Example Shop</Nm></Cdtr></RltdPties></TxDtls>',
			},
			expected: row({amount: '-5.00', counterpartyName: 'Example Shop'}),
		},
		{
			name: 'details that disagree leave the counterparty empty but keep every remittance line',
			entry: {
				amount: '30.00',
				details:
					counterpartyDetails(
						'Cdtr',
						'Example One',
						'NL44RABO0123456789',
						'<RmtInf><Ustrd>First</Ustrd></RmtInf>',
					) +
					counterpartyDetails(
						'Cdtr',
						'Example Two',
						'NL39RABO0300065264',
						'<RmtInf><Ustrd>Second</Ustrd></RmtInf>',
					),
			},
			expected: row({amount: '-30.00', remittanceInformation: 'First Second', referenceNumber: 'E2E-EXAMPLE'}),
		},
		{
			name: 'a structured creditor reference without free text is the remittance text',
			entry: {
				amount: '10.00',
				details:
					'<TxDtls><RltdPties><Cdtr><Nm>Example Shop</Nm></Cdtr></RltdPties><RmtInf><Strd><CdtrRefInf><Tp>' +
					'<CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry><Issr>BBA</Issr></Tp><Ref>123456789002</Ref></CdtrRefInf></Strd>' +
					'</RmtInf></TxDtls>',
			},
			expected: row({amount: '-10.00', counterpartyName: 'Example Shop', remittanceInformation: '123456789002'}),
		},
		{
			name: 'free text, structured text and an RF or QR reference are joined in that order',
			entry: {
				amount: '10.00',
				details:
					'<TxDtls><RmtInf><Ustrd>Invoice 12</Ustrd><Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry>' +
					'</CdOrPrtry></Tp><Ref>210000000003139471430009017</Ref></CdtrRefInf><AddtlRmtInf>Order 1001</AddtlRmtInf>' +
					'</Strd><Strd><CdtrRefInf><Ref>RF18539007547034</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>',
			},
			expected: row({
				amount: '-10.00',
				remittanceInformation: 'Invoice 12 Order 1001 210000000003139471430009017 RF18539007547034',
			}),
		},
		{
			name: 'the ultimate creditor is the counterparty when the creditor is not named',
			entry: {
				amount: '10.00',
				details: '<TxDtls><RltdPties><UltmtCdtr><Nm>Example Shop</Nm></UltmtCdtr></RltdPties></TxDtls>',
			},
			expected: row({amount: '-10.00', counterpartyName: 'Example Shop'}),
		},
		{
			name: 'an ultimate debtor other than the debtor is added to the description',
			entry: {
				amount: '10.00',
				indicator: 'CRDT' as const,
				info: 'Transfer',
				details:
					'<TxDtls><RltdPties><Dbtr><Pty><Nm>Example Payments</Nm></Pty></Dbtr>' +
					'<UltmtDbtr><Pty><Nm>Example Customer</Nm></Pty></UltmtDbtr></RltdPties></TxDtls>',
			},
			expected: row({
				amount: '10.00',
				creditDebitIndicator: 'CRDT',
				counterpartyName: 'Example Payments',
				description: 'Transfer Example Customer',
			}),
		},
	])('$name', ({entry, expected}) => {
		const [statement] = parse(camt053([{entries: [entry]}]));

		expect(statement.rows).toEqual([expected]);
	});

	it.each(['02', '08'])(
		'reads the statement account and, for ABN AMRO in version %s, adds the balance after each row in booking order',
		(version) => {
			const statements = parse(
				camt053(
					[
						{
							sequence: '61',
							opening: '1000.00',
							closing: '1137.50',
							// Newest first, as ABN AMRO lists them.
							entries: [
								{amount: '150.00', indicator: 'CRDT', reference: 'B'},
								{amount: '1.00', status: 'PDNG', reference: 'C'},
								{amount: '12.50', reference: 'A'},
							],
						},
					],
					version,
				),
			);

			expect(statements).toEqual([
				{
					format: 'camt053',
					layout: null,
					accountIban: EXAMPLE_IBAN,
					accountOtherId: null,
					bank: null,
					servicerBic: 'ABNANL2A',
					accountCurrency: 'EUR',
					sequenceNumber: '61',
					entriesSkipped: 1,
					openingBalance: {date: '2026-03-01', amount: '1000.00'},
					closingBalance: {date: '2026-03-01', amount: '1137.50'},
					rows: [
						expect.objectContaining({bankReference: 'B', amount: '150.00', balanceAfter: '1137.50'}),
						expect.objectContaining({bankReference: 'A', amount: '-12.50', balanceAfter: '987.50'}),
					],
				},
			]);
		},
	);

	it('gives the single row of a statement from any bank the closing balance', () => {
		const [statement] = parse(
			camt053([{servicerBic: 'EXAMPLEXX', opening: '1000.00', closing: '987.50', entries: [{amount: '12.50'}]}]),
		);
		// Balances without a leading zero, dated with a time zone.
		const [swiss] = parse(
			camt053([
				{
					servicerBic: 'EXAMPLEXX',
					opening: '.71',
					closing: '.50',
					openingDate: '2026-03-01+02:00',
					closingDate: '2026-03-02-05:00',
					entries: [{amount: '.21'}],
				},
			]),
		);

		expect(statement.rows.map(({balanceAfter}) => balanceAfter)).toEqual(['987.50']);
		expect(swiss).toMatchObject({
			openingBalance: {date: '2026-03-01', amount: '0.71'},
			closingBalance: {date: '2026-03-02', amount: '0.50'},
			rows: [{amount: '-0.21', balanceAfter: '0.50'}],
		});
	});

	it.each([
		{name: 'comes from a bank whose entry order is unknown', statement: {servicerBic: 'EXAMPLEXX'}},
		{name: 'names no account servicer', statement: {servicerBic: null}},
	])(
		'leaves the balance after empty for a statement with several rows that $name, keeping its stated balances',
		({statement}) => {
			const [parsed] = parse(
				camt053([
					{
						opening: '-1000.00',
						closing: '-1014.50',
						openingDate: '2026-03-01',
						closingDate: '2026-03-02',
						...statement,
						entries: [{amount: '12.50'}, {amount: '2.00'}],
					},
				]),
			);

			expect(parsed.rows.map(({balanceAfter}) => balanceAfter)).toEqual([null, null]);
			expect(parsed).toMatchObject({
				openingBalance: {date: '2026-03-01', amount: '-1000.00'},
				closingBalance: {date: '2026-03-02', amount: '-1014.50'},
			});
		},
	);

	it.each([
		{name: 'several rows of a bank whose entry order is unknown', bic: 'EXAMPLEXX', entries: ['12.50', '2.00']},
		{name: 'several rows of a bank whose entry order is known', bic: 'ABNANL2A', entries: ['12.50', '2.00']},
		{name: 'one row', bic: 'EXAMPLEXX', entries: ['12.50']},
		{name: 'one row without a leading zero', bic: 'EXAMPLEXX', entries: ['.21']},
		{name: 'no rows', bic: 'EXAMPLEXX', entries: []},
	])('refuses a statement of $name whose entries do not add up to its closing balance', ({bic, entries}) => {
		const xml = camt053([
			{
				servicerBic: bic,
				opening: '1000.00',
				closing: '999.00',
				entries: entries.map((amount) => ({amount})),
			},
		]);

		expect(() => parse(xml)).toThrow(new ParseRefusal('parse_failed'));
	});

	it('reads a Swiss statement with amounts without a leading zero and dates with a time zone, and refuses it altered', () => {
		const [statement] = parse(SWISS_FILE);

		expect(statement).toMatchObject({
			accountIban: 'CH9300762011623852957',
			openingBalance: {date: '2026-10-01', amount: '0.95'},
			closingBalance: {date: '2026-10-01', amount: '100.64'},
			rows: [
				{
					bookingDate: '2026-10-01',
					valueDate: '2026-10-01',
					amount: '-0.21',
					counterpartyName: 'Example Bank Fees',
				},
				{
					bookingDate: '2026-10-01',
					valueDate: '2026-10-01',
					amount: '99.90',
					counterpartyName: 'Example Customer AG',
				},
			],
		});
		expect(() => parse(SWISS_FILE.replace('>.21<', '>.22<'))).toThrow(new ParseRefusal('parse_failed'));
	});

	it('keeps the closing balance of a statement that states no opening balance, and states none without one', () => {
		const [closedOnly, neither] = parse(
			camt053([
				{closing: '985.50', closingDate: '2026-03-02', entries: [{amount: '12.50'}, {amount: '2.00'}]},
				{entries: [{amount: '1.00'}]},
			]),
		);

		expect(closedOnly).toMatchObject({
			openingBalance: null,
			closingBalance: {date: '2026-03-02', amount: '985.50'},
		});
		expect(neither).toMatchObject({openingBalance: null, closingBalance: null});
	});

	it('reads a later version: wrapped status codes, DtTm dates as written, nested party names and several statements', () => {
		const later = camt053(
			[
				{
					otherId: 'EXAMPLE-ACCOUNT-1',
					currency: 'USD',
					entries: [
						{
							amount: '9.99',
							details:
								'<TxDtls><RltdPties><Cdtr><Pty><Nm>Example Store</Nm></Pty></Cdtr></RltdPties></TxDtls>',
						},
					],
				},
				{iban: EXAMPLE_IBAN, entries: [{amount: '1.00', status: 'INFO'}]},
			],
			'08',
		).replace(
			'<BookgDt><Dt>2026-03-02</Dt></BookgDt>',
			'<BookgDt><DtTm>2026-03-02T23:30:00-05:00</DtTm></BookgDt>',
		);

		const statements = parse(later);

		expect(statements).toEqual([
			expect.objectContaining({
				accountIban: null,
				accountOtherId: 'EXAMPLE-ACCOUNT-1',
				accountCurrency: 'USD',
				rows: [
					expect.objectContaining({
						bookingDate: '2026-03-02',
						amount: '-9.99',
						currency: 'USD',
						counterpartyName: 'Example Store',
					}),
				],
			}),
			expect.objectContaining({accountIban: EXAMPLE_IBAN, entriesSkipped: 1, rows: []}),
		]);
	});

	it('reads the booked entries of a camt.052 account report, with the balances of a statement', () => {
		const report = camt053([
			{
				servicerBic: 'EXAMPLEXX',
				opening: '1000.00',
				closing: '987.50',
				entries: [
					{amount: '12.50', reference: 'BOOKED'},
					{amount: '5.00', status: 'PDNG', reference: 'PENDING'},
				],
			},
		])
			.replace('camt.053.001.02', 'camt.052.001.02')
			.replace(/BkToCstmrStmt>/g, 'BkToCstmrAcctRpt>')
			.replace(/<(\/?)Stmt>/g, '<$1Rpt>');
		expect(report).toContain('<BkToCstmrAcctRpt><GrpHdr>');

		const result = parseFile(Buffer.from(report));

		expect(result).toMatchObject({
			formats: ['camt053'],
			statements: [
				{
					accountIban: EXAMPLE_IBAN,
					entriesSkipped: 1,
					rows: [
						expect.objectContaining({bankReference: 'BOOKED', amount: '-12.50', balanceAfter: '987.50'}),
					],
				},
			],
		});
		// An interim booked balance is no end-of-day balance: more may be booked that day.
		const interim = parseFile(Buffer.from(report.replace('<Cd>CLBD</Cd>', '<Cd>ITBD</Cd>')));
		expect(interim.statements[0].rows.map(({balanceAfter}) => balanceAfter)).toEqual([null]);
	});

	it.each([
		{
			name: 'an internal entity declaration',
			xml: camt053([{entries: [{amount: '1.00', info: '&bomb;'}]}]).replace(
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE Document [<!ENTITY bomb "boom">]>',
			),
			code: 'parse_failed',
		},
		{
			name: 'an external entity',
			xml: camt053([{entries: [{amount: '1.00', info: '&ext;'}]}]).replace(
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE Document [<!ENTITY ext SYSTEM "file:///etc/hostname">]>',
			),
			code: 'parse_failed',
		},
		{
			name: 'an undeclared entity',
			xml: camt053([{entries: [{amount: '1.00', info: '&undeclared;'}]}]),
			code: 'parse_failed',
		},
		{
			name: 'malformed markup',
			xml: camt053([{entries: [{amount: '1.00'}]}]).replace('</Stmt>', ''),
			code: 'parse_failed',
		},
		{
			name: 'an amount that is not a decimal',
			xml: camt053([{entries: [{amount: '1,00'}]}]),
			code: 'parse_failed',
		},
		{
			name: 'a date that does not exist',
			xml: camt053([{entries: [{amount: '1.00', bookingDate: '2026-02-30'}]}]),
			code: 'parse_failed',
		},
		{
			name: 'an amount with no digits',
			xml: camt053([{entries: [{amount: '.'}]}]),
			code: 'parse_failed',
		},
		{
			name: 'a time zone that is not one',
			xml: camt053([{entries: [{amount: '1.00', bookingDate: '2026-03-02+2'}]}]),
			code: 'parse_failed',
		},
		{
			name: 'a camt.054 notification',
			xml: camt053([{entries: []}]).replace('camt.053.001.02', 'camt.054.001.02'),
			code: 'unsupported_format',
		},
	])('refuses $name with $code', ({xml, code}) => {
		expect(() => parse(xml)).toThrow(new ParseRefusal(code as ParseRefusal['code']));
	});
});
