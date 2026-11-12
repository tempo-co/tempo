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
	'synced_account_not_supported_yet',
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

/** `POST /bank-imports` (201) and each item of `GET /bank-imports`, newest first. */
export type BankImportSummary = {
	id: string;
	format: BankImportFormat;
	filesCount: number;
	rowsParsed: number;
	rowsAdded: number;
	rowsAlreadyPresent: number;
	rowsDoubtful: number;
	/** Earliest and latest booking date in the drop; null when it held no entries. */
	dateFrom: string | null;
	dateTo: string | null;
	accounts: BankImportAccount[];
	undoneAt: string | null;
	createdAt: string;
};
