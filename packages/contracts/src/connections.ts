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

/**
 * How long a bank may go without a fully successful sync before the owner is told: an email and push, and a
 * warning on Connections. Shorter failures retry on their own and stay quiet.
 */
export const SYNC_BROKEN_AFTER_MS = 24 * 60 * 60 * 1000;

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

/**
 * The `code` of a refused bank-connection request: imported files cannot be refreshed or re-authorized
 * (`file_connection_not_syncable`), and only an imported-files account takes a balance from its owner
 * (`balance_from_bank`).
 */
export type BankConnectionErrorCode = 'file_connection_not_syncable' | 'balance_from_bank';

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

/**
 * Where an account's current balance comes from: the bank sync reported it (`bank`), the imported statements state
 * it (`file`), or the owner entered it for an imported-files account (`stated`), with later imported rows added.
 */
export const BANK_ACCOUNT_BALANCE_SOURCES = ['bank', 'file', 'stated'] as const;
export type BankAccountBalanceSource = (typeof BANK_ACCOUNT_BALANCE_SOURCES)[number];

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
	/** When the balance was reported; for an imported-files account midnight UTC of the day it applies to. */
	balanceUpdatedAt: string | null;
	/** Null when `currentBalanceAmount` is. */
	balanceSource: BankAccountBalanceSource | null;
	isActive: boolean;
	/** The bank's latest reported balances; always empty for an imported-files account. */
	latestBalances: BankAccountBalance[];
};

/**
 * `PUT /bank-connections/:connectionId/accounts/:accountId/balance`: the balance of an imported-files account today,
 * answered with the account. A signed decimal with at most two decimals, such as `-12.50`.
 */
export type SetBankAccountBalanceRequest = {amount: string};

/** `GET /bank-connections`: one connected bank and its accounts. */
export type BankConnection = {
	id: string;
	provider: string;
	aspspName: string;
	aspspCountry: string;
	logo?: BankLogoReference;
	status: BankConnectionStatus;
	consentValidUntil: string | null;
	/** The last run that fetched anything, including partial runs. */
	lastSyncedAt: string | null;
	/** The last run that fetched everything; null when none has. */
	lastSuccessfulSyncAt: string | null;
	createdAt: string;
	lastSyncError: string | null;
	nextSyncAt: string | null;
	syncStatus: BankSyncStatus;
	/** The reporting currency; null while there is none or its amounts are being converted (`GET /reporting-currency`). */
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
