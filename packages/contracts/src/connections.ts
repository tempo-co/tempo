import type {
	BankTransactionCashFlowTreatment,
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
	BankTransactionFinancialEventSource,
	BankTransactionFinancialEventType,
} from './transactions.js';
import type {BankTransactionCategory} from './categories.js';

export const BANK_CONNECTION_STATUSES = [
	'AUTHORIZED',
	'EXPIRED',
	'RUNNING',
	'PENDING_AUTHORIZATION',
	'CANCELLED',
	'FAILED',
] as const;
export type BankConnectionStatus = (typeof BANK_CONNECTION_STATUSES)[number];

/** How long before consent ends the owner is told to re-authorize: an email, and a dot on Connections. */
export const CONSENT_ENDING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export const BANK_SYNC_STATUSES = [
	'IDLE',
	'QUEUED',
	'RUNNING',
	'SUCCEEDED',
	'PARTIAL',
	'FAILED',
	'RATE_LIMITED',
	'EXPIRED',
] as const;
export type BankSyncStatus = (typeof BANK_SYNC_STATUSES)[number];

/** Lazy metadata keeps catalogue reads independent of downloading every bank's artwork. */
export type BankLogoReference = {metadataUrl: string};
/** `GET /bank-connections/aspsps/logos/:country/:name`. Image URLs include source hash and converter version. */
export type BankLogo = {url: string};

/** `GET /bank-connections/aspsps`: a bank that can be connected. */
export type BankConnectionAspsp = {
	name: string;
	country: string;
	/** Original provider URL for older clients. New clients use `logo`. */
	logoUrl?: string;
	logo?: BankLogoReference;
};

/** `POST /bank-connections/authorize` body. */
export type BankConnectionAuthorizationRequest = {
	aspspName: string;
	/** ISO 3166 alpha-2 country code. */
	aspspCountry: string;
};

/** `POST /bank-connections/authorize`: where to send the owner to approve access. */
export type BankConnectionAuthorizationResponse = {authorizationUrl: string};

/** `DELETE /bank-connections/:connectionId` body. */
export type BankConnectionRemoveRequest = {confirmation?: string};

export type BankAccountBalance = {
	name: string | null;
	balanceType: string;
	amount: string;
	currency: string;
	lastChangeDateTime: string | null;
	referenceDate: string | null;
	observedAt: string;
	isPrimary: boolean;
};

export type BankAccount = {
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
	/** Approximate: the current balance converted at `baseCurrencyRateDate`'s ECB rate, to the cent. */
	currentBalanceInBaseCurrency: string | null;
	/** The ECB rate date used; null when no conversion was needed or possible. */
	baseCurrencyRateDate: string | null;
	balanceUpdatedAt: string | null;
	isActive: boolean;
	latestBalances: BankAccountBalance[];
};

/** `GET /bank-connections`: one connected bank and its accounts. */
export type BankConnection = {
	id: string;
	provider: string;
	aspspName: string;
	aspspCountry: string;
	logo?: BankLogoReference;
	status: BankConnectionStatus;
	consentValidUntil: string | null;
	lastSyncedAt: string | null;
	lastSyncError: string | null;
	nextSyncAt: string | null;
	syncStatus: BankSyncStatus;
	/** The owner's base currency; null until the first conversion run has picked one. */
	baseCurrency: string | null;
	bankAccounts: BankAccount[];
};

/** `GET /bank-connections/:connectionId/transactions` query. */
export type BankConnectionTransactionsQuery = {limit?: number};

export type BankConnectionTransaction = {
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
};

/** `GET /bank-connections/:connectionId/transactions`: the connection's latest rows. */
export type BankConnectionTransactionsResponse = {
	transactions: BankConnectionTransaction[];
	total: number;
};

/** `POST /bank-connections/:connectionId/refresh`: the finished run, or no content when it synced moments ago. */
export type BankSyncRun = {
	id: string;
	status: BankSyncStatus;
	startedAt: string;
	finishedAt: string | null;
	requestedFrom: string | null;
	requestedTo: string | null;
	accountsFetched: number;
	balancesFetched: number;
	transactionsFetched: number;
	transactionsAdded: number;
	errorMessage: string | null;
	rateLimitSource: 'enable-banking' | null;
	retryAfterSeconds: number | null;
};
