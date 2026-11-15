import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {MAX_SAVED_LAYOUTS, MAX_SAVED_LAYOUT_BYTES, buildLayout, mappingOf} from './bank-import-layout.service';
import {LayoutAnswer, layoutAnswerSchema} from './mapper/layout-mapper.contract';
import {validateCsvLayout} from './parsers/csv-layout';
import {readCsvLayout} from './parsers/csv-layout-reader';
import {sampleTable} from './parsers/table-sample';
import {MAX_REQUEST_BYTES} from './runner/parse-runner.protocol';

const FIXTURES = join(__dirname, '../../../../test/fixtures/file-import');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

describe('saved layout limits', () => {
	it("keep an owner's every saved layout inside one request to the file reader", () => {
		// The request line also holds the mode and the JSON list around the layouts.
		expect(MAX_SAVED_LAYOUTS * (MAX_SAVED_LAYOUT_BYTES + 1) + 64).toBeLessThan(MAX_REQUEST_BYTES);
	});
});

describe('buildLayout', () => {
	const ANSWER: LayoutAnswer = {
		bankName: null,
		dateFormat: 'DD/MM/YYYY',
		bookingDate: 0,
		valueDate: null,
		amount: {kind: 'signed', column: 3},
		decimalMark: '.',
		thousandsSeparator: null,
		currency: {code: 'GBP'},
		balance: null,
		counterpartyName: null,
		counterpartyAccount: null,
		description: [1],
		account: null,
		transactionDate: null,
		pending: null,
	};

	/** The file's statements as the proposal previews them, with the layout the answer builds on it. */
	function propose(file: string | Buffer, answer: Partial<LayoutAnswer>) {
		const bytes = typeof file === 'string' ? Buffer.from(file) : file;
		const sample = sampleTable(bytes)!;
		const built = buildLayout(layoutAnswerSchema.parse({...ANSWER, ...answer}), sample, 'EUR')!;
		const validation = validateCsvLayout(built.layout);
		if (!validation.ok) throw new Error(validation.error);
		const read = readCsvLayout(bytes, [validation.layout], {owned: true, today: '2026-11-15'});
		return {
			layout: validation.layout,
			mapping: mappingOf(validation.layout, sample.header),
			statements: read?.statements.map(({accountIban, bank, rows}) => ({
				accountIban,
				bank,
				rows: rows.map(({amount, counterpartyIban}) => [amount, counterpartyIban]),
			})),
			rows: read?.statements.flatMap(({rows}) => rows),
		};
	}

	const lines = (...rows: string[]) => [...rows, ''].join('\n');

	it('leaves out an account column that holds no IBAN, so the file names no account and goes by bank and currency', () => {
		// Lloyds writes the sort code and the account number in two columns.
		const file = fixture('lloyds-sort-code-synthetic.csv');
		const answer: Partial<LayoutAnswer> = {
			amount: {kind: 'debitCredit', moneyOutColumn: 5, moneyInColumn: 6},
			balance: {column: 7, when: 'after'},
			description: [4],
			account: {column: 3},
		};

		const proposed = propose(file, answer);

		expect(proposed.layout.accountIban).toBeUndefined();
		expect(proposed.statements).toEqual([
			{
				accountIban: null,
				bank: 'Proposed',
				rows: [
					['-4.50', null],
					['1500.00', null],
					['-62.10', null],
					['-23.00', null],
				],
			},
		]);
		// A column of IBANs is the account.
		const ibans = Buffer.from(file.toString('utf8').replace(/12345678/g, 'GB33BUKB20201555555555'));
		expect(propose(ibans, answer).statements).toEqual([
			expect.objectContaining({accountIban: 'GB33BUKB20201555555555', bank: null}),
		]);
	});

	it('leaves out an account line that holds no IBAN, and keeps one that does', () => {
		const text = (account: string) =>
			lines(
				`Account,${account}`,
				'Date,Description,Type,Amount',
				'02/10/2026,Example Shop,DEB,-4.20',
				'03/10/2026,Example Employer,FPI,2500.00',
			);

		expect(propose(text('20-00-00 12345678'), {account: {line: 0}}).layout.accountIbanLine).toBeUndefined();
		expect(propose(text('GB33 BUKB 2020 1555 5555 55'), {account: {line: 0}}).statements).toEqual([
			expect.objectContaining({accountIban: 'GB33BUKB20201555555555'}),
		]);
	});

	it('leaves out a counterparty account column holding text that is no IBAN, and keeps IBANs and old account numbers', () => {
		const text = (card: string) =>
			lines(
				'Date,Description,Their account,Amount',
				'02/10/2026,Example Shop,' + card + ',-4.20',
				'03/10/2026,Example Employer,GB33BUKB20201555555555,2500.00',
				'05/10/2026,Example Energy,12345678,-60.00',
			);

		expect(propose(text('Example card payment'), {counterpartyAccount: 2}).layout.counterpartyIban).toBeUndefined();
		expect(propose(text(''), {counterpartyAccount: 2}).statements?.[0].rows).toEqual([
			['-4.20', null],
			['2500.00', 'GB33BUKB20201555555555'],
			['-60.00', null],
		]);
	});

	it("names the other party from the payer's column on money in and the payee's on money out, below the account's line", () => {
		// DKB: the holder fills one of the two name columns on every row; the IBAN column is the other party's.
		const proposed = propose(fixture('dkb-payer-payee-synthetic.csv'), {
			dateFormat: 'DD.MM.YY',
			bookingDate: 0,
			valueDate: 1,
			amount: {kind: 'signed', column: 8},
			decimalMark: ',',
			thousandsSeparator: '.',
			currency: {code: 'EUR'},
			counterpartyName: {moneyIn: 3, moneyOut: 4},
			counterpartyAccount: 7,
			description: [5],
			pending: 2,
			account: {line: 0},
		});

		expect(proposed.statements?.map(({accountIban}) => accountIban)).toEqual(['DE89370400440532013000']);
		expect(
			proposed.rows?.map(({amount, counterpartyName, counterpartyIban}) => [
				amount,
				counterpartyName,
				counterpartyIban,
			]),
		).toEqual([
			['-60.00', 'Example Energy AG', 'NL91ABNA0417164300'],
			['2500.00', 'Example Employer GmbH', 'GB33BUKB20201555555555'],
			['50.00', 'Example Tenant', 'NL91ABNA0417164300'],
		]);
		expect(proposed.mapping.columns).toEqual(
			expect.arrayContaining([
				{field: 'counterparty', column: 4, header: 'Zahlungspflichtige*r', onlyFor: 'moneyIn'},
				{field: 'counterparty', column: 5, header: 'Zahlungsempfänger*in', onlyFor: 'moneyOut'},
				{field: 'counterpartyAccount', column: 8, header: 'IBAN'},
			]),
		);
	});

	it("dates a card statement's rows by settlement, and keeps the purchase date as the transaction date", () => {
		// KBC's card export: datum verrichting is the purchase, Datum verrekening the settlement.
		const proposed = propose(fixture('kbc-creditcard-synthetic.csv'), {
			bookingDate: 4,
			transactionDate: 3,
			amount: {kind: 'signed', column: 10},
			decimalMark: ',',
			currency: {column: 8},
			counterpartyName: 12,
			description: [],
		});

		expect(proposed.rows?.map(({bookingDate, transactionDate}) => [bookingDate, transactionDate])).toEqual([
			['2026-10-03', '2026-10-01'],
			['2026-10-03', '2026-10-02'],
			['2026-10-06', '2026-10-04'],
		]);
		expect(proposed.mapping.columns.slice(0, 2)).toEqual([
			{field: 'date', column: 5, header: 'Datum verrekening'},
			{field: 'transactionDate', column: 4, header: 'datum verrichting'},
		]);
	});

	it('skips the rows the answer names as not booked yet', () => {
		// comdirect dates a card payment not booked yet offen, with -- as its value date.
		const proposed = propose(fixture('comdirect-pending-synthetic.csv'), {
			dateFormat: 'DD.MM.YYYY',
			valueDate: 1,
			amount: {kind: 'signed', column: 4},
			decimalMark: ',',
			thousandsSeparator: '.',
			currency: {code: 'EUR'},
			description: [3],
			pending: 0,
		});

		expect(proposed.rows?.map(({bookingDate, amount}) => [bookingDate, amount])).toEqual([
			['2026-10-05', '-62.10'],
			['2026-10-02', '2100.00'],
		]);
		expect(proposed.mapping.columns).toContainEqual({field: 'pending', column: 1, header: 'Buchungstag'});
	});
});
