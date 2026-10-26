import type {BankTransactionLocation} from './bank-transaction-location';

export type EnableBankingPsuContext = {
	ipAddress: string;
	userAgent?: string;
};

export type EnableBankingAspsp = {
	name: string;
	country: string;
	logoUrl?: string;
	maximumConsentValiditySeconds: number;
	requiredPsuHeaders?: string[];
};

export type StartEnableBankingAuthorizationInput = {
	state: string;
	redirectUrl: string;
	psuId: string;
	aspsp: {
		name: string;
		country: string;
	};
	validUntil: string;
};

export type StartEnableBankingAuthorizationResult = {
	url: string;
	authorizationId: string;
};

export type EnableBankingAccount = {
	uid?: string;
	identificationHash: string;
	iban?: string;
	name?: string;
	details?: string;
	currency: string;
	cashAccountType?: string;
	usage?: string;
};

export type EnableBankingSession = {
	sessionId: string;
	accounts: EnableBankingAccount[];
	aspsp: {
		name: string;
		country: string;
	};
	consentValidUntil: string;
};

export type EnableBankingSessionAccounts = {
	status: string;
	accountIds: string[];
};

export type EnableBankingBalance = {
	name?: string;
	balanceType: string;
	amount: string;
	currency: string;
	lastChangeDateTime?: string;
	referenceDate?: string;
	lastCommittedTransaction?: string;
};

export type EnableBankingTransaction = {
	providerTransactionId?: string;
	entryReference?: string;
	merchantCategoryCode?: string;
	amount: string;
	currency: string;
	creditDebitIndicator?: string;
	status?: string;
	transactionDate?: string;
	bookingDate?: string;
	valueDate?: string;
	description?: string;
	counterpartyName?: string;
	counterpartyIban?: string;
	counterpartyLocation?: BankTransactionLocation;
	remittanceInformation?: string;
	bankTransactionCode?: string;
	bankTransactionSubCode?: string;
	bankTransactionDescription?: string;
	balanceAfterAmount?: string;
	balanceAfterCurrency?: string;
	instructedAmount?: string;
	instructedCurrency?: string;
	exchangeRate?: string;
	exchangeRateUnitCurrency?: string;
	exchangeRateType?: string;
	referenceNumber?: string;
	referenceNumberScheme?: string;
};

export type EnableBankingTransactionFetchOptions = {
	strategy: 'default' | 'longest';
	dateFrom?: string;
	dateTo?: string;
};
