import {MAX_SAVED_LAYOUTS, MAX_SAVED_LAYOUT_BYTES, buildLayout, mappingOf} from './bank-import-layout.service';
import {LayoutAnswer, layoutAnswerSchema} from './mapper/layout-mapper.contract';
import {validateCsvLayout} from './parsers/csv-layout';
import {readCsvLayout} from './parsers/csv-layout-reader';
import {sampleTable} from './parsers/table-sample';
import {MAX_REQUEST_BYTES} from './runner/parse-runner.protocol';

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
	function propose(text: string, answer: Partial<LayoutAnswer>) {
		const bytes = Buffer.from(text);
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
		const text = lines(
			'Date,Description,Account,Amount',
			"02/10/2026,Example Shop,'20-00-00 12345678,-4.20",
			"03/10/2026,Example Employer,'20-00-00 12345678,2500.00",
			"05/10/2026,Example Energy,'20-00-00 12345678,-60.00",
		);

		const proposed = propose(text, {account: {column: 2}});

		expect(proposed.layout.accountIban).toBeUndefined();
		expect(proposed.statements).toEqual([
			{
				accountIban: null,
				bank: 'Proposed',
				rows: [
					['-4.20', null],
					['2500.00', null],
					['-60.00', null],
				],
			},
		]);
		// A column of IBANs is the account.
		const ibans = text.replace(/'20-00-00 12345678/g, 'GB33BUKB20201555555555');
		expect(propose(ibans, {account: {column: 2}}).statements).toEqual([
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

	it("names the other party from the payer's column on money in and the payee's on money out", () => {
		const holder = 'Erika Example';
		const text = lines(
			'Date,Description,Payer,Amount,Payee,IBAN',
			`03/10/2026,Example card,${holder},-4.20,Example Bakery,GB33BUKB20201555555555`,
			`02/10/2026,Salary,Example Employer,2500.00,${holder},NL91ABNA0417164300`,
			`01/10/2026,Energy,${holder},-60.00,Example Energy,GB33BUKB20201555555555`,
			`30/09/2026,Garage,Example Tenant,50.00,${holder},NL91ABNA0417164300`,
		);

		const proposed = propose(text, {counterpartyName: {moneyIn: 2, moneyOut: 4}, counterpartyAccount: 5});

		expect(proposed.rows?.map(({amount, counterpartyName}) => [amount, counterpartyName])).toEqual([
			['-4.20', 'Example Bakery'],
			['2500.00', 'Example Employer'],
			['-60.00', 'Example Energy'],
			['50.00', 'Example Tenant'],
		]);
		expect(proposed.mapping.columns).toEqual(
			expect.arrayContaining([
				{field: 'counterparty', column: 3, header: 'Payer', onlyFor: 'moneyIn'},
				{field: 'counterparty', column: 5, header: 'Payee', onlyFor: 'moneyOut'},
				{field: 'counterpartyAccount', column: 6, header: 'IBAN'},
			]),
		);
	});

	it("dates a card statement's rows by settlement, and keeps the purchase date as the transaction date", () => {
		const text = lines(
			'Card,Purchase date,Settlement date,Description,Amount',
			'1234,01/10/2026,03/10/2026,Example Shop,-4.20',
			'1234,02/10/2026,03/10/2026,Example Cafe,-3.10',
			'1234,04/10/2026,05/10/2026,Example Market,-41.25',
		);

		const proposed = propose(text, {
			bookingDate: 2,
			transactionDate: 1,
			description: [3],
			amount: {kind: 'signed', column: 4},
		});

		expect(proposed.rows?.map(({bookingDate, transactionDate}) => [bookingDate, transactionDate])).toEqual([
			['2026-10-03', '2026-10-01'],
			['2026-10-03', '2026-10-02'],
			['2026-10-05', '2026-10-04'],
		]);
		expect(proposed.mapping.columns.slice(0, 2)).toEqual([
			{field: 'date', column: 3, header: 'Settlement date'},
			{field: 'transactionDate', column: 2, header: 'Purchase date'},
		]);
	});

	it('skips the rows the answer names as not booked yet', () => {
		const text = lines(
			'Buchungstag;Wertstellung;Vorgang;Buchungstext;Umsatz in EUR',
			'offen;--;Example;Example card payment;-41,25',
			'05.10.2026;05.10.2026;Example;Example Energy;-62,10',
			'02.10.2026;02.10.2026;Example;Example Employer;2.100,00',
		);

		const proposed = propose(text, {
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
