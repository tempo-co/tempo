import type {BankTransactionCategory} from '@tempo/contracts';

import type {
	BankTransactionCashFlowTreatment,
	BankTransactionFinancialEventSource,
	BankTransactionFinancialEventType,
} from '../../bank-transaction-financial-event';
import type {
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
} from '../../categorization/bank-transaction-categorization.types';

export class BankConnectionAspspResponseDto {
	name: string;
	country: string;
	logoUrl?: string;
}

export class BankAccountResponseDto {
	id: string;
	name: string | null;
	details: string | null;
	alias: string | null;
	currency: string;
	cashAccountType: string | null;
	usage: string | null;
	maskedIdentifier: string | null;
	currentBalanceAmount: string | null;
	currentBalanceType: string | null;
	/** Approximate: the current balance converted at {@link baseCurrencyRateDate}'s ECB rate, to the cent. */
	currentBalanceInBaseCurrency: string | null;
	/** The ECB rate date used; null when no conversion was needed or possible. */
	baseCurrencyRateDate: string | null;
	balanceUpdatedAt: Date | null;
	isActive: boolean;
	latestBalances: BankAccountBalanceResponseDto[];
}

export class BankAccountBalanceResponseDto {
	name: string | null;
	balanceType: string;
	amount: string;
	currency: string;
	lastChangeDateTime: Date | null;
	referenceDate: string | null;
	observedAt: Date;
	isPrimary: boolean;
}

export class BankConnectionResponseDto {
	id: string;
	provider: string;
	aspspName: string;
	aspspCountry: string;
	status: string;
	consentValidUntil: Date | null;
	lastSyncedAt: Date | null;
	lastSyncError: string | null;
	nextSyncAt: Date | null;
	syncStatus: string;
	/** The owner's base currency; null until the first conversion run has picked one. */
	baseCurrency: string | null;
	bankAccounts: BankAccountResponseDto[];
}

export class BankConnectionTransactionResponseDto {
	id: string;
	bookingDate: string | null;
	valueDate: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: string | null;
	transactionStatus: string | null;
	description: string | null;
	displayDescription: string;
	/** Path of the merchant's logo image, null when no confirmed logo exists. */
	merchantLogoUrl: string | null;
	counterpartyName: string | null;
	category: BankTransactionCategory | null;
	categoryStatus: BankTransactionCategorizationStatus;
	categorySource: BankTransactionCategorizationSource | null;
	financialEventType: BankTransactionFinancialEventType | null;
	financialEventSource: BankTransactionFinancialEventSource | null;
	financialEventRuleVersion: string | null;
	cashFlowTreatment: BankTransactionCashFlowTreatment;
	categoryConfidence: string | null;
	merchantCategoryCode: string | null;
	remittanceInformation: string | null;
}

export class BankConnectionTransactionsResponseDto {
	transactions: BankConnectionTransactionResponseDto[];
	total: number;
}

export class BankSyncRunResponseDto {
	id: string;
	status: string;
	startedAt: Date;
	finishedAt: Date | null;
	requestedFrom: string | null;
	requestedTo: string | null;
	accountsFetched: number;
	balancesFetched: number;
	transactionsFetched: number;
	transactionsAdded: number;
	errorMessage: string | null;
	rateLimitSource: 'enable-banking' | null;
	retryAfterSeconds: number | null;
}
