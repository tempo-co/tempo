import {
	BANK_TRANSACTION_CASH_FLOW_TREATMENTS,
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	detectBankTransactionFinancialEvent,
	getBankTransactionCashFlowTreatment,
} from './bank-transaction-financial-event';

describe('bank transaction financial events', () => {
	const baseInput = {
		provider: 'enable-banking',
		aspspName: 'Revolut',
		accountCurrency: 'EUR',
		transactionCurrency: 'EUR',
		description: 'Exchanged to GBP',
		creditDebitIndicator: null,
	};

	it('classifies a Revolut debit leg as a currency exchange', () => {
		expect(
			detectBankTransactionFinancialEvent({
				...baseInput,
				creditDebitIndicator: 'DBIT',
			}),
		).toEqual({
			type: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			source: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
			ruleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
		});
	});

	it('classifies a Revolut credit leg when its currency is the target currency', () => {
		expect(
			detectBankTransactionFinancialEvent({
				...baseInput,
				accountCurrency: 'GBP',
				transactionCurrency: 'GBP',
				creditDebitIndicator: 'CRDT',
			}),
		).toEqual({
			type: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			source: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
			ruleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
		});
	});

	it.each([
		['a different provider', {...baseInput, aspspName: 'Synthetic Bank'}],
		['a different provider integration', {...baseInput, provider: 'other-provider'}],
		['a malformed description', {...baseInput, description: 'Exchange to GBP'}],
		['a description with extra text', {...baseInput, description: 'Exchanged to GBP fee'}],
		['a description for the reverse direction', {...baseInput, description: 'Exchanged from EUR'}],
		['a missing indicator', {...baseInput, creditDebitIndicator: null}],
		['an unknown indicator', {...baseInput, creditDebitIndicator: 'BOOK'}],
		[
			'a debit leg already in the target currency',
			{...baseInput, creditDebitIndicator: 'DBIT', transactionCurrency: 'GBP'},
		],
		[
			'a credit leg outside the target currency',
			{...baseInput, creditDebitIndicator: 'CRDT', transactionCurrency: 'EUR', accountCurrency: 'EUR'},
		],
		['an account and transaction currency mismatch', {...baseInput, accountCurrency: 'GBP'}],
		['a same-currency exchange', {...baseInput, creditDebitIndicator: 'DBIT', description: 'Exchanged to EUR'}],
	])('does not classify %s', (_caseName, input) => {
		expect(detectBankTransactionFinancialEvent(input)).toBeNull();
	});

	it('does not use exchange-rate metadata as an exchange signal', () => {
		const inputWithExchangeRateMetadata = {
			...baseInput,
			description: 'Card payment',
			creditDebitIndicator: 'DBIT',
			exchangeRate: '1.12',
		};

		expect(detectBankTransactionFinancialEvent(inputWithExchangeRateMetadata)).toBeNull();
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
