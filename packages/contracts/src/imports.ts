/** The format of a drop's files; `mixed` when the drop held files of more than one format. */
export const BANK_IMPORT_FORMATS = ['camt053', 'mt940', 'abnAmroTxt', 'revolutCsv', 'revolutXlsx', 'mixed'] as const;
export type BankImportFormat = (typeof BANK_IMPORT_FORMATS)[number];

/**
 * What one drop may hold. The API refuses more; the web refuses a choice over them before uploading it. A drop's
 * size is the size of its files together.
 */
export const BANK_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const BANK_IMPORT_MAX_FILES = 20;
export const BANK_IMPORT_MAX_DROP_BYTES = 25 * 1024 * 1024;

/** Why a drop was refused. A refused drop writes nothing. */
export const BANK_IMPORT_ERROR_CODES = [
	'unsupported_format',
	/** An old binary Excel (`.xls`) file: the owner picks another export of the same data. */
	'legacy_xls_not_supported',
	'file_too_large',
	/** The drop's files together are larger than `BANK_IMPORT_MAX_DROP_BYTES`. */
	'drop_too_large',
	'archive_too_large',
	'too_many_files',
	'too_many_rows',
	'parse_failed',
	'parse_timeout',
	/** More than one synced account fits a statement: the owner chooses one. */
	'ambiguous_target_account',
	/**
	 * A statement that names no account was routed by its bank to a synced account, but fewer than half of its rows
	 * within that account's stored dates are found there: the owner confirms or chooses the account.
	 */
	'target_account_unconfirmed',
	'target_account_mismatch',
	'account_busy',
	'multiple_bank_connections',
	/** Other drops took every upload slot for too long (HTTP 503 with `Retry-After`): the same files can be sent again. */
	'import_busy',
] as const;
export type BankImportErrorCode = (typeof BANK_IMPORT_ERROR_CODES)[number];

/** An account the owner can choose for a statement. */
export type BankImportAccountCandidate = {
	bankAccountId: string;
	name: string | null;
	currency: string;
	/** The bank of the account's connection; `Imported files` for an imported-files account. */
	bankName: string;
	/** Whether this is an imported-files account rather than one bank sync holds. */
	imported: boolean;
};

/**
 * A statement of a file that names no account, which needs the owner to choose its account. It is answered with
 * the key `<bank>:<currency>` in `accountChoices`; besides `candidates`, the owner can choose `new`.
 */
export type BankImportAccountQuestion = {
	bank: string;
	currency: string;
	candidates: BankImportAccountCandidate[];
};

/** The body of a refused `POST /bank-imports`. */
export type BankImportError = {
	statusCode: number;
	message: string;
	code: BankImportErrorCode;
	/** The refused file's 1-based position in the request; null when the refusal is about the whole drop. */
	file: number | null;
	/**
	 * On `ambiguous_target_account` and `target_account_unconfirmed`: every statement of the drop that names no
	 * account and needs an answer, one per bank and currency. A statement that names its account (by IBAN or another
	 * id) is not listed; the owner names its account in `bankAccountId` instead.
	 */
	accountQuestions?: BankImportAccountQuestion[];
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
 * row. The request may carry one of two optional multipart text fields, never both:
 * - `bankAccountId`: the account a drop of one account's statements goes to.
 * - `accountChoices`: a JSON object answering `accountQuestions`, from `<bank>:<currency>` (for example
 *   `Revolut:EUR`) to a bank account id or `new` (the imported-files account of that bank and currency, created when
 *   missing). A statement with a key goes where it says; the others are routed automatically.
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
