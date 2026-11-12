export const BANK_IMPORT_FORMATS = ['camt053'] as const;
export type BankImportFormat = (typeof BANK_IMPORT_FORMATS)[number];

/** Why a drop was refused. A refused drop writes nothing. */
export const BANK_IMPORT_ERROR_CODES = [
	'unsupported_format',
	'file_too_large',
	'archive_too_large',
	'too_many_files',
	'too_many_rows',
	'parse_failed',
	'parse_timeout',
	'ambiguous_target_account',
	'target_account_mismatch',
	'account_busy',
	'multiple_bank_connections',
] as const;
export type BankImportErrorCode = (typeof BANK_IMPORT_ERROR_CODES)[number];

/** The body of a refused `POST /bank-imports`. */
export type BankImportError = {
	statusCode: number;
	message: string;
	code: BankImportErrorCode;
	/** The refused file's 1-based position in the request; null when the refusal is about the whole drop. */
	file: number | null;
};

/** An account an import wrote to. Accounts removed since (for example by an undo) are left out. */
export type BankImportAccount = {
	id: string;
	name: string | null;
	currency: string;
	/** Whether this import created the account. */
	created: boolean;
};

/**
 * `POST /bank-imports` (201), each item of `GET /bank-imports`, newest first, and the answer to resolving a doubtful
 * row. The request may name the target account in the optional multipart text field `bankAccountId`.
 */
export type BankImportSummary = {
	id: string;
	format: BankImportFormat;
	filesCount: number;
	rowsParsed: number;
	rowsAdded: number;
	/** Rows found already stored: the three ladder counts below, plus doubtful rows resolved as duplicates. */
	rowsAlreadyPresent: number;
	/** Found by the bank reference. */
	rowsMatchedByReference: number;
	/** Found by amount, value date and balance after. */
	rowsMatchedByBalance: number;
	/** Found by amount on the same day, or the only candidate within three days. */
	rowsMatchedByDate: number;
	/** Rows held for the owner to decide, still open. */
	rowsDoubtful: number;
	/** Earliest and latest booking date in the drop; null when it held no entries. */
	dateFrom: string | null;
	dateTo: string | null;
	accounts: BankImportAccount[];
	undoneAt: string | null;
	createdAt: string;
};

/** A row as the statement file states it. Amounts are signed decimal strings; dates are `YYYY-MM-DD`. */
export type BankImportFileRow = {
	bookingDate: string | null;
	valueDate: string | null;
	amount: string;
	currency: string;
	balanceAfter: string | null;
	bankReference: string | null;
	counterpartyName: string | null;
	description: string | null;
	remittanceInformation: string | null;
};

/** A stored transaction a doubtful row may be. */
export type BankImportDoubtfulCandidate = {
	id: string;
	transactionDate: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	amount: string;
	currency: string;
	displayDescription: string | null;
	counterpartyName: string | null;
};

/** Each item of `GET /bank-imports/:importId/doubtful-rows`: open rows only, in booking order. */
export type BankImportDoubtfulRow = {
	id: string;
	bankAccountId: string;
	row: BankImportFileRow;
	/** The candidates that still exist. */
	candidates: BankImportDoubtfulCandidate[];
};

export const BANK_IMPORT_DOUBTFUL_DECISIONS = ['new', 'duplicate'] as const;
export type BankImportDoubtfulDecision = (typeof BANK_IMPORT_DOUBTFUL_DECISIONS)[number];

/**
 * `POST /bank-imports/:importId/doubtful-rows/:rowId/resolve`, answered with the import's `BankImportSummary`.
 * `new` adds the row; `duplicate` names the candidate it already is (`transactionId`) and adds nothing.
 */
export type ResolveBankImportDoubtfulRowRequest = {
	decision: BankImportDoubtfulDecision;
	/** Required for `duplicate`: one of the row's current candidates. */
	transactionId?: string;
};
