/** Refusals a parser can reach on its own; the parent adds size, timeout and account refusals. */
export const PARSE_REFUSAL_CODES = [
	'unsupported_format',
	'legacy_xls_not_supported',
	'file_too_large',
	'archive_too_large',
	'too_many_files',
	'too_many_rows',
	'parse_failed',
	/** A file laid out like a known bank's CSV export whose rows do not read as that export's. */
	'layout_not_recognized',
	/** A file no reader claims that reads as a table: delimited text, or a workbook that is no Revolut statement. */
	'layout_unknown',
] as const;
export type ParseRefusalCode = (typeof PARSE_REFUSAL_CODES)[number];

export class ParseRefusal extends Error {
	/** On `layout_not_recognized`: the id of the CSV layout the file looked like. */
	constructor(
		readonly code: ParseRefusalCode,
		readonly layout: string | null = null,
	) {
		super(code);
		this.name = 'ParseRefusal';
	}
}

/**
 * One booked entry as the file states it. Amounts are decimal strings, signed (negative for a debit);
 * dates are `YYYY-MM-DD`.
 */
export type NormalizedRow = {
	bookingDate: string | null;
	valueDate: string | null;
	transactionDate: string | null;
	amount: string;
	creditDebitIndicator: 'CRDT' | 'DBIT';
	currency: string;
	balanceAfter: string | null;
	bankReference: string | null;
	counterpartyName: string | null;
	counterpartyIban: string | null;
	remittanceInformation: string | null;
	description: string | null;
	bankTransactionCode: string | null;
	bankTransactionSubCode: string | null;
	referenceNumber: string | null;
};

export const STATEMENT_FORMATS = ['camt053', 'mt940', 'abnAmroTxt', 'revolutCsv', 'revolutXlsx', 'csv', 'ofx'] as const;
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];

/**
 * Banks whose files name no account; the owner's account at that bank is found by currency instead. An owner's
 * saved layout whose files name no account works the same way, under the bank name the owner gave it.
 */
export const STATEMENT_BANKS = ['Revolut'] as const;

export type NormalizedStatement = {
	format: StatementFormat;
	/** The id of the bank's CSV layout the statement was read with; null for every other format. */
	layout: string | null;
	/** The statement account's IBAN, or null when it is identified by another id. */
	accountIban: string | null;
	/** The account's other id (CAMT `Acct/Id/Othr/Id`, MT940 `:25:`) when it has no IBAN. */
	accountOtherId: string | null;
	/**
	 * The bank of a file that names no account at all (one of `STATEMENT_BANKS`, or the bank of the owner's saved
	 * layout it was read with); null whenever the file has an IBAN or other id.
	 */
	bank: string | null;
	accountCurrency: string;
	/** The statement's electronic sequence number, as written. */
	sequenceNumber: string | null;
	/** Entries left out because they are not booked. */
	entriesSkipped: number;
	rows: NormalizedRow[];
};

export type ParseResult = {
	/** Statement files read: 1 for a plain file or a workbook, the entry count for an archive. */
	files: number;
	/** The formats of the files read, each once, in the order first met; a file without statements counts too. */
	formats: StatementFormat[];
	/** The CSV layouts of the files read, each once, in the order first met. */
	layouts: string[];
	statements: NormalizedStatement[];
};

/** What the parse runner writes to stdout for a parse. */
export type ParseRunnerOutput =
	| ({ok: true} & ParseResult)
	/** `layout`: on `layout_not_recognized` only, the id of the CSV layout the file looked like. */
	| {ok: false; code: ParseRefusalCode; layout?: string};
