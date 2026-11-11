import {EXAMPLE_IBAN, camt053} from '../../../../../test/fixtures/statement-file.fixture';
import {parseCamt053} from './camt053';
import {NormalizedRow, ParseRefusal} from './parse-result';

const parse = (xml: string) => parseCamt053(Buffer.from(xml));

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
	])('$name', ({entry, expected}) => {
		const [statement] = parse(camt053([{entries: [entry]}]));

		expect(statement.rows).toEqual([expected]);
	});

	it('reads the statement account and adds the balance after each row when the closing balance reconciles', () => {
		const statements = parse(
			camt053([
				{
					sequence: '61',
					opening: '1000.00',
					closing: '1137.50',
					entries: [
						{amount: '12.50', reference: 'A'},
						{amount: '150.00', indicator: 'CRDT', reference: 'B'},
						{amount: '1.00', status: 'PDNG', reference: 'C'},
					],
				},
			]),
		);

		expect(statements).toEqual([
			{
				accountIban: EXAMPLE_IBAN,
				accountOtherId: null,
				accountCurrency: 'EUR',
				sequenceNumber: '61',
				entriesSkipped: 1,
				rows: [
					expect.objectContaining({bankReference: 'A', amount: '-12.50', balanceAfter: '987.50'}),
					expect.objectContaining({bankReference: 'B', amount: '150.00', balanceAfter: '1137.50'}),
				],
			},
		]);
	});

	it('leaves the balance after empty for a statement that does not reconcile', () => {
		const [statement] = parse(
			camt053([{opening: '1000.00', closing: '999.00', entries: [{amount: '12.50'}, {amount: '2.00'}]}]),
		);

		expect(statement.rows.map(({balanceAfter}) => balanceAfter)).toEqual([null, null]);
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
			name: 'a camt.054 notification',
			xml: camt053([{entries: []}]).replace('camt.053.001.02', 'camt.054.001.02'),
			code: 'unsupported_format',
		},
	])('refuses $name with $code', ({xml, code}) => {
		expect(() => parse(xml)).toThrow(new ParseRefusal(code as ParseRefusal['code']));
	});
});
