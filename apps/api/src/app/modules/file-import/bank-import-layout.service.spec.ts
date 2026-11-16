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
		// A column that holds more than one account is checked as one account, so the reader refuses the file
		// rather than merge them.
		const twoAccounts = file.toString('utf8').split('\n');
		twoAccounts[3] = twoAccounts[3].replace('12345678', '87654321');
		twoAccounts[4] = twoAccounts[4].replace('12345678', '87654321');
		const merged = propose(Buffer.from(twoAccounts.join('\n')), answer);
		expect(merged.layout).toEqual(expect.objectContaining({oneAccountColumn: 3}));
		expect(merged.layout.accountIban).toBeUndefined();
		expect(merged.statements).toBeUndefined();
		// The layout saved from a one-account file keeps that column to check: a later file of two is refused.
		expect(proposed.layout.oneAccountColumn).toBe(3);
		expect(
			readCsvLayout(Buffer.from(twoAccounts.join('\n')), [proposed.layout], {owned: true, today: '2026-11-15'}),
		).toBeNull();
		expect(readCsvLayout(file, [proposed.layout], {owned: true, today: '2026-11-15'})?.statements).toHaveLength(1);
		// A column of IBANs is the account.
		const ibans = Buffer.from(file.toString('utf8').replace(/12345678/g, 'GB33BUKB20201555555555'));
		expect(propose(ibans, answer).statements).toEqual([
			expect.objectContaining({accountIban: 'GB33BUKB20201555555555', bank: null}),
		]);
	});

	it('leaves out an account column of no IBAN in a file too short to show one value on every row', () => {
		// Raiffeisenbank (CZ): an account number with a bank code, in a one-row export.
		const proposed = propose(fixture('raiffeisen-cz-one-row-synthetic.csv'), {
			dateFormat: 'DD.MM.YYYY',
			bookingDate: 1,
			amount: {kind: 'signed', column: 13},
			decimalMark: ',',
			thousandsSeparator: ' ',
			currency: {column: 14},
			counterpartyName: 6,
			description: [8],
			account: {column: 2},
		});

		expect(proposed.layout).toEqual(expect.objectContaining({oneAccountColumn: 2}));
		expect(proposed.statements).toEqual([{accountIban: null, bank: 'Proposed', rows: [['-120.50', null]]}]);
	});

	it('leaves out a balance column that holds one value on every row: the current balance, not one per row', () => {
		// Boursorama repeats the account's balance at the time of the export on every row.
		const proposed = propose(fixture('boursorama-current-balance-synthetic.csv'), {
			dateFormat: 'YYYY-MM-DD',
			valueDate: 1,
			amount: {kind: 'signed', column: 6},
			decimalMark: ',',
			thousandsSeparator: ' ',
			currency: {code: 'EUR'},
			balance: {column: 10, when: 'after'},
			description: [2],
		});

		expect(proposed.layout.balance).toBeUndefined();
		expect(proposed.rows?.map(({amount, balanceAfter}) => [amount, balanceAfter])).toEqual([
			['-62.10', null],
			['2500.00', null],
			['-12.50', null],
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

	const rowsOf = (proposed: ReturnType<typeof propose>) =>
		proposed.rows?.map(({bookingDate, amount, description}) => [bookingDate, amount, description]);
	const ROWS = (descriptions: string[], amounts = ['-12.50', '2500.00', '-62.10']) =>
		['2026-10-02', '2026-10-05', '2026-10-09'].map((date, index) => [date, amounts[index], descriptions[index]]);

	it.each<{name: string; fixture: string; answer: Partial<LayoutAnswer>; rows: unknown[]}>([
		{
			name: 'Postbank, every line padded to the table width',
			fixture: 'postbank-padded-synthetic.csv',
			answer: {
				dateFormat: 'DD.MM.YYYY',
				valueDate: 1,
				amount: {kind: 'signed', column: 11},
				decimalMark: ',',
				thousandsSeparator: '.',
				currency: {column: 17},
				counterpartyName: 3,
				description: [4],
			},
			rows: ROWS(['Example card payment', 'Example salary', 'Example bill']),
		},
		{
			name: 'Intesa Sanpaolo, padded and with empty lines around the table',
			fixture: 'intesa-padded-synthetic.csv',
			answer: {
				amount: {kind: 'signed', column: 7},
				decimalMark: ',',
				thousandsSeparator: '.',
				currency: {column: 6},
				description: [1, 2],
			},
			rows: ROWS(['Pagamento Example Shop', 'Stipendio Example Employer', 'Addebito Example Energy']),
		},
		{
			name: 'UniCredit, a padded balance preamble and footer',
			fixture: 'unicredit-trailer-synthetic.csv',
			answer: {
				dateFormat: 'DD.MM.YYYY',
				valueDate: 1,
				amount: {kind: 'signed', column: 4},
				currency: {code: 'EUR'},
				description: [3],
			},
			rows: ROWS(['Example Shop', 'Example Employer', 'Example Energy']),
		},
		{
			name: 'a Spanish bank, a padded preamble naming the account',
			fixture: 'consulta-movimientos-synthetic.csv',
			answer: {
				valueDate: 2,
				amount: {kind: 'signed', column: 3},
				decimalMark: ',',
				thousandsSeparator: '.',
				currency: {code: 'EUR'},
				balance: {column: 4, when: 'after'},
				description: [1],
				account: {line: 2},
			},
			rows: ROWS(['Example Shop', 'Example Employer', 'Example Energy']),
		},
		{
			name: 'Sparda-Bank, a summary line of values above its header',
			fixture: 'sparda-summary-line-synthetic.csv',
			answer: {
				dateFormat: 'DD.MM.YYYY',
				valueDate: 1,
				amount: {kind: 'signed', column: 3},
				decimalMark: ',',
				thousandsSeparator: '.',
				currency: {column: 4},
				description: [2],
			},
			rows: ROWS(['Example Shop', 'Example Employer', 'Example Energy']),
		},
		{
			name: 'mBank, windows-1250 with a totals line above its header',
			fixture: 'mbank-totals-cp1250-synthetic.csv',
			answer: {
				dateFormat: 'YYYY-MM-DD',
				amount: {kind: 'signed', column: 4},
				decimalMark: ',',
				thousandsSeparator: ' ',
				currency: {code: 'PLN'},
				description: [1],
			},
			rows: ROWS(['Żabka Example Wrocław', 'Example Pracodawca Sp. z o.o.', 'Example Energia Łódź']),
		},
		{
			name: 'PKO BP, windows-1250',
			fixture: 'pko-cp1250-synthetic.csv',
			answer: {
				dateFormat: 'YYYY-MM-DD',
				valueDate: 1,
				amount: {kind: 'signed', column: 3},
				currency: {column: 4},
				balance: {column: 5, when: 'after'},
				description: [6],
			},
			rows: ROWS(['Żabka Example Ślężna', 'Example Księgarnia Częstochowa', 'Example Energia Łódź']),
		},
		{
			name: "Erste Bank's George, UTF-16LE",
			fixture: 'george-utf16-synthetic.csv',
			answer: {
				dateFormat: 'DD.MM.YYYY',
				valueDate: 1,
				amount: {kind: 'signed', column: 2},
				decimalMark: ',',
				thousandsSeparator: '.',
				currency: {column: 6},
				counterpartyName: 3,
				counterpartyAccount: 4,
				description: [8],
			},
			rows: ROWS(['Example card payment', 'Example salary', 'Example bill']),
		},
		{
			name: 'Nationwide, month names and pound signs',
			fixture: 'nationwide-month-names-synthetic.csv',
			answer: {
				dateFormat: 'DD MMM YYYY',
				amount: {kind: 'debitCredit', moneyOutColumn: 3, moneyInColumn: 4},
				thousandsSeparator: ',',
				balance: {column: 5, when: 'after'},
				description: [2],
			},
			rows: ROWS(['Example Shop', 'Example Employer Ltd', 'Example Energy']),
		},
		{
			name: 'Erste Bank (HU), dates ending in a dot',
			fixture: 'erste-hu-dotted-dates-synthetic.csv',
			answer: {
				dateFormat: 'YYYY.MM.DD',
				valueDate: 10,
				amount: {kind: 'signed', column: 6},
				currency: {column: 7},
				balance: {column: 14, when: 'after'},
				counterpartyName: 1,
				description: [13],
			},
			rows: [
				['2026-10-02', '-1250.00', 'Example card'],
				['2026-10-05', '250000.00', 'Example salary'],
			],
		},
		{
			name: 'Monzo, date-times with a UTC offset',
			fixture: 'monzo-offset-synthetic.csv',
			answer: {
				dateFormat: 'YYYY-MM-DD',
				bookingDate: 1,
				amount: {kind: 'signed', column: 2},
				currency: {column: 3},
				description: [8],
			},
			rows: ROWS(['EXAMPLE SHOP', 'EXAMPLE EMPLOYER', 'EXAMPLE ENERGY']),
		},
		{
			name: 'Crédit Agricole Italia, amounts after an apostrophe',
			fixture: 'creditagricole-it-apostrophe-synthetic.csv',
			answer: {
				valueDate: 1,
				amount: {kind: 'signed', column: 4},
				decimalMark: ',',
				currency: {column: 5},
				description: [3],
			},
			rows: ROWS(['Example Shop', 'Example Employer', 'Example Energy']),
		},
	])('reads $name with the layout its answer builds', ({fixture: name, answer, rows}) => {
		const proposed = propose(fixture(name), answer);

		expect(rowsOf(proposed)).toEqual(rows);
	});

	// The answers the mapper's instructions ask for on files where description text and the holder's account are easy
	// to mistake for the other party's (`LAYOUT_MAPPER_INSTRUCTIONS`).
	it.each<{name: string; fixture: string; answer: Partial<LayoutAnswer>; rows: unknown[]}>([
		{
			name: 'PKO BP, labelled cells under empty headings',
			fixture: 'pko-labelled-cells-synthetic.csv',
			answer: {
				dateFormat: 'YYYY-MM-DD',
				valueDate: 1,
				amount: {kind: 'signed', column: 3},
				currency: {column: 4},
				balance: {column: 5, when: 'after'},
				description: [6, 7, 8, 9, 10],
			},
			rows: [
				[
					null,
					'Tytuł: 000000000000001 Lokalizacja: Adres: Example Sklep Miasto: Example Data wykonania: 2026-10-01 Oryginalna kwota operacji: 12.50 PLN',
				],
				[
					null,
					'Tytuł: Example wynagrodzenie Nazwa nadawcy: Example Pracodawca Rachunek nadawcy: PL27114020040000300201355387',
				],
				[
					null,
					'Tytuł: Example rachunek 10/2026 Nazwa odbiorcy: Example Energia Rachunek odbiorcy: PL27114020040000300201355387',
				],
			],
		},
		{
			name: 'Bank Pekao, source and target account columns that swap with the direction',
			fixture: 'pekao-source-target-synthetic.csv',
			answer: {
				dateFormat: 'DD.MM.YYYY',
				valueDate: 1,
				amount: {kind: 'signed', column: 7},
				decimalMark: ',',
				thousandsSeparator: ' ',
				currency: {column: 8},
				counterpartyName: 2,
				description: [6],
			},
			rows: [
				['Example Energia', 'Example rachunek 10/2026'],
				['Example Pracodawca', 'Example wynagrodzenie'],
				['Example Sklep', '*********0001'],
			],
		},
	])('reads $name with the answer the instructions ask for', ({fixture: name, answer, rows}) => {
		const proposed = propose(fixture(name), answer);

		expect(proposed.statements?.map(({accountIban}) => accountIban)).toEqual([null]);
		expect(proposed.rows?.map(({counterpartyName, description}) => [counterpartyName, description])).toEqual(rows);
	});

	it("refuses a file whose answer takes a source or target account column for the holder's account", () => {
		// The holder's account moves between the two columns with the direction, so either holds several values.
		const file = fixture('pekao-source-target-synthetic.csv');
		for (const column of [4, 5]) {
			const answer: Partial<LayoutAnswer> = {
				dateFormat: 'DD.MM.YYYY',
				valueDate: 1,
				amount: {kind: 'signed', column: 7},
				decimalMark: ',',
				thousandsSeparator: ' ',
				currency: {column: 8},
				counterpartyName: 2,
				description: [6],
				account: {column},
			};
			const built = buildLayout(layoutAnswerSchema.parse({...ANSWER, ...answer}), sampleTable(file)!, 'EUR')!;
			const validation = validateCsvLayout(built.layout);
			if (!validation.ok) throw new Error(validation.error);

			expect(validation.layout.oneAccountColumn).toBe(column);
			expect(() => readCsvLayout(file, [validation.layout], {owned: true})).toThrow('layout_not_recognized');
		}
	});

	it('never saves a padded title or name line as the layout header, or as the header the proposal records', () => {
		const rows = ['05.10.2026;-12,50;EUR;Shop;Ref;X', '06.10.2026;-4,20;EUR;Cafe;Ref;Y'];
		for (const lines of [
			['Kontoinhaber Example Person;;;;;', ...rows],
			['Datum;Betrag;Waehrung;Name;Referenz;Text', 'Example Person;;;;;', ...rows],
		]) {
			const sample = sampleTable(Buffer.from(lines.join('\n')))!;
			const built = buildLayout(
				layoutAnswerSchema.parse({
					...ANSWER,
					dateFormat: 'DD.MM.YYYY',
					decimalMark: ',',
					amount: {kind: 'signed', column: 1},
				}),
				sample,
				'EUR',
			)!;

			// The proposal stores `sample.header` as its header cells.
			expect(sample.header).toBeNull();
			expect(built.layout).toMatchObject({recognize: {columnCount: 6}});
			expect(JSON.stringify(built.layout)).not.toMatch(/Kontoinhaber|Example|Person/);
		}
	});

	it("takes the answer's currency only when the file shows it to the model, and otherwise asks the owner", () => {
		const built = (text: string, code: string) =>
			buildLayout(
				layoutAnswerSchema.parse({
					...ANSWER,
					dateFormat: 'DD.MM.YYYY',
					decimalMark: ',',
					amount: {kind: 'signed', column: 1},
					currency: {code},
				}),
				sampleTable(Buffer.from(text))!,
				'GBP',
			)!;
		const file = (header: string, amounts: [string, string], above: string[] = [], text = 'Shop') =>
			lines(...above, header, `05.10.2026;${amounts[0]};${text}`, `06.10.2026;${amounts[1]};${text}`);
		const plain = file('Datum;Betrag;Text', ['-12,50', '-4,20']);

		// A valid code the file never shows: the owner picks the currency, starting from their own.
		expect(built(plain, 'CHF')).toMatchObject({currencyNeeded: true, layout: {currency: {fixed: 'GBP'}}});
		// A code masked in a longer cell is not shown either.
		expect(built(file('Datum;Betrag;Text', ['-12,50 CHF', '-4,20 CHF']), 'CHF')).toMatchObject({
			currencyNeeded: true,
		});
		// The code in the header, as a cell of a line above the table, or as a row's cell.
		for (const shown of [
			file('Datum;Betrag (CHF);Text', ['-12,50', '-4,20']),
			file('Datum;Betrag;Text', ['-12,50', '-4,20'], ['Waehrung;CHF']),
			file('Datum;Betrag;Waehrung', ['-12,50', '-4,20'], [], 'CHF'),
		]) {
			expect(built(shown, 'CHF')).toMatchObject({currencyNeeded: false, layout: {currency: {fixed: 'CHF'}}});
		}
		// An unambiguous symbol the model saw names its currency; a shared one, or another currency's, does not.
		const euros = file('Datum;Betrag;Text', ['-12,50 €', '-4,20 €']);
		expect(built(euros, 'EUR')).toMatchObject({currencyNeeded: false, layout: {currency: {fixed: 'EUR'}}});
		expect(built(euros, 'GBP')).toMatchObject({currencyNeeded: true});
		expect(built(file('Datum;Kwota (zł);Text', ['-12,50', '-4,20']), 'PLN')).toMatchObject({currencyNeeded: false});
		expect(built(file('Datum;Betrag;Text', ['-12,50 $', '-4,20 $']), 'USD')).toMatchObject({currencyNeeded: true});
		// Masked letters show the model nothing: zł in a row is sent as aa.
		expect(built(file('Datum;Betrag;Text', ['-12,50 zł', '-4,20 zł']), 'PLN')).toMatchObject({
			currencyNeeded: true,
		});
	});

	it('reads dates with a two-digit year after the month name, and cannot read a headerless file with nothing to check', () => {
		const shortYears = Buffer.from(
			fixture('nationwide-month-names-synthetic.csv')
				.toString('utf8')
				.replace(/ 2026"/g, ' 26"'),
		);
		expect(
			propose(shortYears, {
				dateFormat: 'DD MMM YY',
				amount: {kind: 'debitCredit', moneyOutColumn: 3, moneyInColumn: 4},
				thousandsSeparator: ',',
				balance: {column: 5, when: 'after'},
				description: [2],
			}).rows?.map(({bookingDate}) => bookingDate),
		).toEqual(['2026-10-02', '2026-10-05', '2026-10-09']);
		// Barclaycard's headerless export holds nothing besides a date and an amount that every row must pass.
		const file = fixture('barclaycard-uk-short-year-synthetic.csv');
		const built = buildLayout(
			layoutAnswerSchema.parse({...ANSWER, dateFormat: 'DD MMM YY', amount: {kind: 'signed', column: 6}}),
			sampleTable(file)!,
			'GBP',
		)!;
		expect(validateCsvLayout(built.layout)).toEqual({ok: false, error: 'recognize.columnCount'});
	});
});
