import type {
	BankTransactionCashFlowTreatment,
	BankTransactionFinancialEventSource,
	BankTransactionFinancialEventType,
} from '@tempo/contracts';

import type {BankTransactionDirection} from './bank-transaction-direction';
import {normalizeBankTransactionText} from './bank-transaction-display';
import {normalizeCurrency} from './services/bank-transaction-amount-conversion.utils';

export type {BankTransactionCashFlowTreatment, BankTransactionFinancialEventSource, BankTransactionFinancialEventType};

export const BANK_TRANSACTION_FINANCIAL_EVENT_TYPES = {
	CURRENCY_EXCHANGE: 'CURRENCY_EXCHANGE',
} as const satisfies {[T in BankTransactionFinancialEventType]: T};

export const BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES = {
	RULE: 'RULE',
} as const satisfies {[S in BankTransactionFinancialEventSource]: S};

export const BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION = 'currency-exchange-v3';

export const BANK_TRANSACTION_CASH_FLOW_TREATMENTS = {
	INCOME: 'INCOME',
	EXPENSE: 'EXPENSE',
	INTERNAL: 'INTERNAL',
	UNKNOWN: 'UNKNOWN',
} as const satisfies {[T in BankTransactionCashFlowTreatment]: T};

export type CurrencyExchangeMarkerInput = {
	accountCurrency: string | null | undefined;
	transactionCurrency: string | null | undefined;
	creditDebitIndicator: string | null | undefined;
	description: string | null | undefined;
	bankTransactionCode: string | null | undefined;
	bankTransactionSubCode: string | null | undefined;
	/** The bank's own label for its transaction code, which some banks send instead of a code. */
	bankTransactionDescription: string | null | undefined;
};

/** One leg's own evidence that it is half of a currency exchange; only a matching other leg makes it one. */
export type CurrencyExchangeMarker = {
	indicator: 'DBIT' | 'CRDT';
	currency: string;
	/** The currency bought, when the leg names it; a credit leg always buys its own currency. */
	targetCurrency: string | null;
};

/** The whole text is a short exchange phrase naming the bought currency, such as "Exchanged to EUR". */
const EXCHANGE_TO_PHRASE = /^Exchanged? to ([A-Z]{3})$/i;
/** The whole text, or a whole proprietary code, is the single word "exchange". */
const EXCHANGE_WORD = /^exchange$/i;

/** ISO 20022 domain and family of a foreign exchange spot: two currencies exchanged for cash delivery. */
const FOREIGN_EXCHANGE_DOMAIN = 'FORX';
const FOREIGN_EXCHANGE_SPOT_FAMILY = 'SPOT';

export function parseCurrencyExchangeTarget(description: string | null | undefined): string | null {
	const normalized = normalizeBankTransactionText(description);
	return normalized ? (EXCHANGE_TO_PHRASE.exec(normalized)?.[1].toUpperCase() ?? null) : null;
}

/**
 * Reads a leg's exchange marker. Each text (the description and the bank's code label) counts only as a whole: the
 * phrase "Exchange(d) to <currency>" or the single word "exchange". A code counts as a whole too: the proprietary
 * word "exchange", or the ISO 20022 foreign exchange spot code (Enable Banking sends the family as the code, without
 * its domain; a code that carries the domain must name FORX). The leg must move its own account's currency.
 * Conflicting evidence is no marker.
 */
export function detectCurrencyExchangeMarker(input: CurrencyExchangeMarkerInput): CurrencyExchangeMarker | null {
	const accountCurrency = normalizeCurrency(input.accountCurrency);
	const currency = normalizeCurrency(input.transactionCurrency);
	if (!accountCurrency || !currency || accountCurrency !== currency) return null;
	const indicator = input.creditDebitIndicator?.trim().toUpperCase();
	if (indicator !== 'DBIT' && indicator !== 'CRDT') return null;

	const texts = [input.description, input.bankTransactionDescription];
	const targets = new Set(texts.flatMap((text) => parseCurrencyExchangeTarget(text) ?? []));
	if (targets.size > 1) return null;
	const [targetCurrency] = targets;
	if (targetCurrency) {
		const consistent = indicator === 'DBIT' ? targetCurrency !== currency : targetCurrency === currency;
		return consistent ? {indicator, currency, targetCurrency} : null;
	}
	const hasMarker =
		texts.some(isExchangeWord) ||
		[input.bankTransactionCode, input.bankTransactionSubCode].some(isExchangeWord) ||
		hasForeignExchangeSpotCode(input.bankTransactionCode, input.bankTransactionSubCode);
	if (!hasMarker) return null;
	return {indicator, currency, targetCurrency: indicator === 'CRDT' ? currency : null};
}

function isExchangeWord(value: string | null | undefined): boolean {
	return EXCHANGE_WORD.test(normalizeBankTransactionText(value) ?? '');
}

function hasForeignExchangeSpotCode(code: string | null | undefined, subCode: string | null | undefined): boolean {
	const segments = [code, subCode].flatMap((value) =>
		(value ?? '')
			.trim()
			.toUpperCase()
			.split(/[\s\-/.]+/)
			.filter(Boolean),
	);
	const family = segments[0] === FOREIGN_EXCHANGE_DOMAIN ? segments[1] : segments[0];
	return family === FOREIGN_EXCHANGE_SPOT_FAMILY;
}

export function getBankTransactionCashFlowTreatment(
	financialEventType: BankTransactionFinancialEventType | string | null | undefined,
	direction: BankTransactionDirection | string | null | undefined,
	ownTransferEvidence?: string | null,
): BankTransactionCashFlowTreatment {
	if (financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE || ownTransferEvidence) {
		return BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INTERNAL;
	}
	if (direction === BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INCOME) {
		return BANK_TRANSACTION_CASH_FLOW_TREATMENTS.INCOME;
	}
	if (direction === BANK_TRANSACTION_CASH_FLOW_TREATMENTS.EXPENSE) {
		return BANK_TRANSACTION_CASH_FLOW_TREATMENTS.EXPENSE;
	}
	return BANK_TRANSACTION_CASH_FLOW_TREATMENTS.UNKNOWN;
}
