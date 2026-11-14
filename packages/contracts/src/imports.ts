/**
 * The format of a drop's files; `mixed` when the drop held files of more than one format, or bank CSV exports of
 * more than one layout. `csv` is a bank's CSV export, whose layout `BankImportSummary.layout` names.
 */
export const BANK_IMPORT_FORMATS = [
	'camt053',
	'mt940',
	'abnAmroTxt',
	'revolutCsv',
	'revolutXlsx',
	'csv',
	'ofx',
	'mixed',
] as const;
export type BankImportFormat = (typeof BANK_IMPORT_FORMATS)[number];

/** Why a drop was refused. A refused drop writes nothing. */
export const BANK_IMPORT_ERROR_CODES = [
	'unsupported_format',
	/**
	 * A file laid out like a bank's CSV export (`layout` names it) whose rows do not read the way that export's do:
	 * a moved column, another date format, an invalid IBAN or balances that do not follow the amounts.
	 */
	'layout_not_recognized',
	/**
	 * A file no reader claims that reads as a table (delimited text, or a workbook that is no Revolut statement): its
	 * columns can be worked out (`POST /bank-imports/layout-proposals`) when `BankImportList.mapper` is on.
	 */
	'layout_unknown',
	/** An old binary Excel (`.xls`) file: the owner picks another export of the same data. */
	'legacy_xls_not_supported',
	'file_too_large',
	/** The drop's files together are larger than 25 MB. */
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
	/** The column mapper's answer was not a layout that reads every row of the file. */
	'layout_not_mappable',
	/** The column mapper is off, or its model failed, timed out or had no credit. */
	'mapper_unavailable',
	/** The owner asked for the columns of 5 files in the last 24 hours; `retryAt` says when the next one may. */
	'mapper_limit_reached',
	/** The proposal is more than an hour old: work out the columns again. */
	'layout_proposal_expired',
	/** The owner has 50 saved layouts: remove one first. */
	'layout_limit_reached',
] as const;
export type BankImportErrorCode = (typeof BANK_IMPORT_ERROR_CODES)[number];

/** An account the owner can choose for a statement, with the fields the Connections page names accounts by. */
export type BankImportAccountCandidate = {
	bankAccountId: string;
	name: string | null;
	details: string | null;
	alias: string | null;
	cashAccountType: string | null;
	maskedIdentifier: string | null;
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
	/**
	 * Whether `new` creates an account. False once the imported-files account of this bank and currency exists: it is
	 * then among `candidates`, and `new` goes to it.
	 */
	newAccount: boolean;
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
	/** On `layout_not_recognized`: the id of the bank CSV layout the file looked like, such as `ing-nl`. */
	layout?: string;
	/** On `mapper_limit_reached`: when the owner may ask again (ISO 8601). */
	retryAt?: string;
};

/** An account an import wrote to. Accounts removed since (for example by an undo) are left out. */
export type BankImportAccount = {
	id: string;
	name: string | null;
	currency: string;
	/** Whether this import created the account. */
	created: boolean;
};

/** An account the owner can give a balance (`SetBankAccountBalanceRequest`). */
export type BankImportAccountWithoutBalance = {
	id: string;
	name: string | null;
	currency: string;
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
	/** The bank CSV layout the drop's files were read with (such as `ing-nl`) when `format` is `csv`; else null. */
	layout: string | null;
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
	/**
	 * The imported-files accounts this import wrote to that have no balance: neither their rows state one nor has
	 * the owner entered one. Empty for synced accounts and once the import is undone.
	 */
	accountsWithoutBalance: BankImportAccountWithoutBalance[];
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

/**
 * `GET /bank-imports`: the owner's imports, newest first, and whether the deployment works out the columns of a
 * table it does not know (`POST /bank-imports/layout-proposals`).
 */
export type BankImportList = {
	imports: BankImportSummary[];
	mapper: boolean;
};

/** What a column of a proposed layout holds. */
export const BANK_IMPORT_LAYOUT_FIELDS = [
	'date',
	'valueDate',
	'amount',
	/** The column whose value says whether the amount went out or came in. */
	'direction',
	'moneyOut',
	'moneyIn',
	'balance',
	'currency',
	'account',
	'counterparty',
	'counterpartyAccount',
	'description',
] as const;
export type BankImportLayoutField = (typeof BANK_IMPORT_LAYOUT_FIELDS)[number];

/** A column of the file and what it holds; a field such as `description` can take several columns. */
export type BankImportLayoutColumn = {
	field: BankImportLayoutField;
	/** 1-based, as a spreadsheet shows it. */
	column: number;
	/** The column's heading in the file; null when it has none. */
	header: string | null;
};

/** How a proposed layout reads the file. */
export type BankImportLayoutMapping = {
	columns: BankImportLayoutColumn[];
	/** One signed amount, an unsigned amount and a direction, or money out and money in in two columns. */
	amount: 'signed' | 'direction' | 'debitCredit';
	/** For `direction`: the values that mean money out and money in. */
	direction: {moneyOut: string; moneyIn: string} | null;
	/** For a balance column: whether it is the balance after the row or before it. */
	balance: 'after' | 'before' | null;
	/** The 1-based line above the table that names the account; null when a column does, or nothing does. */
	accountLine: number | null;
	/** How dates are written, such as `DD.MM.YYYY`. */
	dateFormat: string;
};

/** A row of the owner's file as Tempo would store it. Amounts are signed decimal strings. */
export type BankImportLayoutPreviewRow = {
	date: string | null;
	amount: string;
	currency: string;
	counterparty: string | null;
	description: string | null;
	balanceAfter: string | null;
};

/** The owner's file read with a proposed layout; returned once and never stored. */
export type BankImportLayoutPreview = {
	rowCount: number;
	dateFrom: string | null;
	dateTo: string | null;
	/** The first 5 rows, and the last 2 when there are more than 7. */
	firstRows: BankImportLayoutPreviewRow[];
	lastRows: BankImportLayoutPreviewRow[];
	/** Money in and money out per currency, both as positive decimal strings. */
	totals: {currency: string; moneyIn: string; moneyOut: string}[];
	/** The IBANs the rows name; empty when the file names no account. */
	accounts: string[];
};

/**
 * `POST /bank-imports/layout-proposals` (201): one file, multipart field `files`. The file's columns as the model
 * worked them out, read through the whole file. Confirm it within an hour, or reject it.
 */
export type BankImportLayoutProposal = {
	id: string;
	expiresAt: string;
	/** The bank the model took the file to be from, at most 60 characters; null when it could not tell. */
	bankName: string | null;
	/** The file states no currency: the owner picks one; the preview uses `defaultCurrency` until then. */
	currencyNeeded: boolean;
	/** The owner's base currency, else EUR. */
	defaultCurrency: string;
	mapping: BankImportLayoutMapping;
	/** When every date reads day first as well as month first: one date as written and as read, for the owner to check. */
	dateCheck: {written: string; date: string} | null;
	preview: BankImportLayoutPreview;
};

/** `POST /bank-imports/layout-proposals/:proposalId/confirm`, answered with the saved `BankImportLayout` (201). */
export type ConfirmBankImportLayoutProposalRequest = {
	/** 1 to 60 characters. */
	bankName: string;
	/** Required when the proposal's `currencyNeeded`; otherwise left out. */
	currency?: string;
};

/**
 * A layout the owner confirmed: every later drop of theirs is tried with it after Tempo's own readers. Each item of
 * `GET /bank-imports/layouts`, newest first; `DELETE /bank-imports/layouts/:layoutId` removes one and leaves what it
 * imported.
 */
export type BankImportLayout = {
	id: string;
	bankName: string;
	createdAt: string;
};
