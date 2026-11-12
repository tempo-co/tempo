import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {OTHER_EXAMPLE_IBAN} from '../../../../../test/fixtures/statement-file.fixture';
import {parseMt940} from './mt940';
import {ParseRefusal} from './parse-result';

const ABN_AMRO_FILE = readFileSync(join(__dirname, '../../../../../test/fixtures/file-import/MT940260305120000.STA'));

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

	it('refuses a statement whose entries do not add up to its closing balance', () => {
		const file = ABN_AMRO_FILE.toString('latin1').replace(':62F:C260302EUR2637,50', ':62F:C260302EUR2637,51');

		expect(() => parseMt940(Buffer.from(file, 'latin1'))).toThrow(new ParseRefusal('parse_failed'));
	});
});
