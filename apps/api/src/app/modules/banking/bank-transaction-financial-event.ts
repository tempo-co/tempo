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

export const BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION = 'revolut-currency-exchange-v1';

export const BANK_TRANSACTION_CASH_FLOW_TREATMENTS = {
	INCOME: 'INCOME',
	EXPENSE: 'EXPENSE',
	INTERNAL: 'INTERNAL',
	UNKNOWN: 'UNKNOWN',
} as const satisfies {[T in BankTransactionCashFlowTreatment]: T};

export type BankTransactionFinancialEvent = {
	type: BankTransactionFinancialEventType;
	source: BankTransactionFinancialEventSource;
	ruleVersion: string;
};

export type BankTransactionFinancialEventInput = {
	provider: string | null | undefined;
	aspspName: string | null | undefined;
	accountCurrency: string | null | undefined;
	transactionCurrency: string | null | undefined;
	creditDebitIndicator: string | null | undefined;
	description: string | null | undefined;
};

const EXCHANGED_TO_DESCRIPTION = /^Exchanged to ([A-Z]{3})$/i;

export function parseCurrencyExchangeTarget(description: string | null | undefined): string | null {
	const normalized = normalizeBankTransactionText(description);
	return normalized ? (EXCHANGED_TO_DESCRIPTION.exec(normalized)?.[1].toUpperCase() ?? null) : null;
}

export function detectBankTransactionFinancialEvent(
	input: BankTransactionFinancialEventInput,
): BankTransactionFinancialEvent | null {
	if (!isRevolutEnableBankingTransaction(input)) return null;

	const accountCurrency = normalizeCurrency(input.accountCurrency);
	const transactionCurrency = normalizeCurrency(input.transactionCurrency);
	if (!accountCurrency || !transactionCurrency || accountCurrency !== transactionCurrency) return null;

	const normalizedTargetCurrency = parseCurrencyExchangeTarget(input.description);
	if (!normalizedTargetCurrency) return null;
	const indicator = input.creditDebitIndicator?.trim().toUpperCase();
	const isSourceLeg = indicator === 'DBIT' && transactionCurrency !== normalizedTargetCurrency;
	const isTargetLeg = indicator === 'CRDT' && transactionCurrency === normalizedTargetCurrency;
	if (!isSourceLeg && !isTargetLeg) return null;

	return {
		type: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		source: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
		ruleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	};
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

function isRevolutEnableBankingTransaction(input: BankTransactionFinancialEventInput): boolean {
	return (
		input.provider?.trim().toLowerCase() === 'enable-banking' && input.aspspName?.trim().toLowerCase() === 'revolut'
	);
}
