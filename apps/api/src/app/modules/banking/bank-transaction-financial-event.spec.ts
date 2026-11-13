import {
	BANK_TRANSACTION_CASH_FLOW_TREATMENTS,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	CurrencyExchangeMarkerInput,
	detectCurrencyExchangeMarker,
	getBankTransactionCashFlowTreatment,
} from './bank-transaction-financial-event';

describe('bank transaction financial events', () => {
	const baseInput: CurrencyExchangeMarkerInput = {
		accountCurrency: 'EUR',
		transactionCurrency: 'EUR',
		description: 'Exchanged to GBP',
		creditDebitIndicator: 'DBIT',
		bankTransactionCode: null,
		bankTransactionSubCode: null,
		bankTransactionDescription: null,
	};
	const spotInput: CurrencyExchangeMarkerInput = {
		...baseInput,
		description: 'Currency conversion',
		bankTransactionCode: 'SPOT',
	};

	it('reads the exchange description as a debit marker naming the bought currency', () => {
		expect(detectCurrencyExchangeMarker(baseInput)).toEqual({
			indicator: 'DBIT',
			currency: 'EUR',
			targetCurrency: 'GBP',
		});
	});

	it('reads the exchange description as a credit marker when the leg buys its own currency', () => {
		expect(
			detectCurrencyExchangeMarker({
				...baseInput,
				accountCurrency: ' gbp ',
				transactionCurrency: 'GBP',
				creditDebitIndicator: ' crdt ',
				description: '  Exchanged\tto  gbp\n',
			}),
		).toEqual({indicator: 'CRDT', currency: 'GBP', targetCurrency: 'GBP'});
	});

	it.each([
		['the ISO 20022 spot family', {bankTransactionCode: 'SPOT'}],
		['the spot family with a sub-family', {bankTransactionCode: ' spot ', bankTransactionSubCode: 'OTHR'}],
		['the foreign exchange domain and spot family in one code', {bankTransactionCode: 'FORX-SPOT-NTAV'}],
		[
			'the domain as code and the family as sub-code',
			{bankTransactionCode: 'FORX', bankTransactionSubCode: 'SPOT'},
		],
	])('reads %s as a marker at any bank, without a target currency on the debit', (_caseName, codes) => {
		expect(detectCurrencyExchangeMarker({...spotInput, ...codes})).toEqual({
			indicator: 'DBIT',
			currency: 'EUR',
			targetCurrency: null,
		});
		expect(detectCurrencyExchangeMarker({...spotInput, ...codes, creditDebitIndicator: 'CRDT'})).toEqual({
			indicator: 'CRDT',
			currency: 'EUR',
			targetCurrency: 'EUR',
		});
	});

	it.each([
		['the shorter phrase in the description', {description: 'Exchange to GBP'}],
		[
			'the phrase in the bank code label',
			{description: 'Card payment', bankTransactionDescription: 'Exchanged to GBP'},
		],
	])('reads %s as a debit marker naming the bought currency', (_caseName, fields) => {
		expect(detectCurrencyExchangeMarker({...baseInput, ...fields})).toEqual({
			indicator: 'DBIT',
			currency: 'EUR',
			targetCurrency: 'GBP',
		});
	});

	const wordInput: CurrencyExchangeMarkerInput = {...baseInput, description: 'Currency conversion'};

	it.each([
		['the word as the bank code label', {bankTransactionDescription: 'Exchange'}],
		['the word as the whole description', {description: ' EXCHANGE '}],
		['the word as a proprietary code', {bankTransactionCode: 'EXCHANGE'}],
		['the word as a proprietary sub-code', {bankTransactionCode: 'OTHR', bankTransactionSubCode: 'exchange'}],
		[
			'the word next to a phrase-free description',
			{description: 'Some remittance text', bankTransactionDescription: 'Exchange'},
		],
	])('reads %s as a marker at any bank, without a target currency on the debit', (_caseName, fields) => {
		expect(detectCurrencyExchangeMarker({...wordInput, ...fields})).toEqual({
			indicator: 'DBIT',
			currency: 'EUR',
			targetCurrency: null,
		});
		expect(detectCurrencyExchangeMarker({...wordInput, ...fields, creditDebitIndicator: 'CRDT'})).toEqual({
			indicator: 'CRDT',
			currency: 'EUR',
			targetCurrency: 'EUR',
		});
	});

	it.each([
		['a malformed description', {...baseInput, description: 'Exchanged into GBP'}],
		['a description with extra text', {...baseInput, description: 'Exchanged to GBP fee'}],
		['a description for the reverse direction', {...baseInput, description: 'Exchanged from EUR'}],
		['a missing indicator', {...baseInput, creditDebitIndicator: null}],
		['an unknown indicator', {...baseInput, creditDebitIndicator: 'BOOK'}],
		[
			'a debit leg already in the target currency',
			{...baseInput, transactionCurrency: 'GBP', accountCurrency: 'GBP'},
		],
		['a credit leg outside the target currency', {...baseInput, creditDebitIndicator: 'CRDT'}],
		['an account and transaction currency mismatch', {...baseInput, accountCurrency: 'GBP'}],
		['a same-currency exchange', {...baseInput, description: 'Exchanged to EUR'}],
		['a spot code on a leg in another currency than its account', {...spotInput, accountCurrency: 'USD'}],
		['a spot family under another domain', {...spotInput, bankTransactionCode: 'PMET-SPOT'}],
		['another foreign exchange family', {...spotInput, bankTransactionCode: 'FORX-NDFX'}],
		['a spot code next to a contradicting exchange description', {...spotInput, description: 'Exchanged to EUR'}],
		['a code that only contains the word', {...spotInput, bankTransactionCode: 'SPOTIFY'}],
		['remittance text that contains the exchange word', {...wordInput, description: 'Book exchange club'}],
		['remittance text that starts with the exchange word', {...wordInput, description: 'Exchange of keys'}],
		['a code that contains the exchange word', {...wordInput, bankTransactionCode: 'CURRENCY_EXCHANGE'}],
		['a code label that contains the exchange word', {...wordInput, bankTransactionDescription: 'Exchange fee'}],
		['the plural or past tense alone', {...wordInput, description: 'Exchanged'}],
		[
			'an exchange word next to a contradicting phrase',
			{...wordInput, bankTransactionDescription: 'Exchange', description: 'Exchanged to EUR'},
		],
		['two phrases naming different currencies', {...baseInput, bankTransactionDescription: 'Exchanged to USD'}],
		[
			'the exchange word on a leg in another currency than its account',
			{...wordInput, bankTransactionCode: 'EXCHANGE', accountCurrency: 'USD'},
		],
		[
			'the exchange word without a direction',
			{...wordInput, bankTransactionCode: 'EXCHANGE', creditDebitIndicator: null},
		],
		[
			'a card payment carrying exchange-rate data',
			{...baseInput, description: 'Card payment', bankTransactionCode: 'PMNT', bankTransactionSubCode: 'CCRD'},
		],
	])('reads no marker from %s', (_caseName, input) => {
		expect(detectCurrencyExchangeMarker(input)).toBeNull();
	});

	it('maps a currency exchange to internal cash-flow treatment', () => {
		expect(
			getBankTransactionCashFlowTreatment(BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE, 'EXPENSE'),
		).toBe(BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INTERNAL);
	});

	it.each([
		['INCOME', BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INCOME],
		['EXPENSE', BANK_TRANSACTION_CASH_FLOW_TREATMENTS.EXPENSE],
		['UNKNOWN', BANK_TRANSACTION_CASH_FLOW_TREATMENTS.UNKNOWN],
	] as const)('keeps the existing %s direction treatment when no event is present', (direction, treatment) => {
		expect(getBankTransactionCashFlowTreatment(null, direction)).toBe(treatment);
	});
});
