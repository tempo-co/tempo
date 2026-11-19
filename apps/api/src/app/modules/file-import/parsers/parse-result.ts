import type {CreditDebitIndicator} from '@tempo/contracts';

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
	/** An owner's saved layout claims the file but would skip lines above its table that look like rows. */
	'layout_not_mappable',
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
	creditDebitIndicator: CreditDebitIndicator;
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
 * Banks whose files name no account; the owner's account at that bank is found by currency instead. A built-in
 * CSV layout whose files name no account (`NO_ACCOUNT_LAYOUT_BANKS`), and an owner's saved one under the bank name the
 * owner gave it, work the same way.
 */
export const STATEMENT_BANKS = ['Revolut'] as const;

/** A balance a statement states: the decimal string as of the end of `date` (`YYYY-MM-DD`), signed. */
export type StatementBalance = {date: string; amount: string};

export type NormalizedStatement = {
	format: StatementFormat;
	/** The id of the bank's CSV layout the statement was read with; null for every other format. */
	layout: string | null;
	/** The statement account's IBAN, or null when it is identified by another id. */
	accountIban: string | null;
	/** The account's other id (CAMT `Acct/Id/Othr/Id`, MT940 `:25:`) when it has no IBAN. */
	accountOtherId: string | null;
	/**
	 * The bank of a file that names no account at all (one of `STATEMENT_BANKS`, or the bank of the CSV layout,
	 * built in or the owner's, it was read with); null whenever the file has an IBAN or other id.
	 */
	bank: string | null;
	accountCurrency: string;
	/** The statement's electronic sequence number, as written. */
	sequenceNumber: string | null;
	/** Entries left out because they are not booked. */
	entriesSkipped: number;
	/**
	 * The booked balance before the statement's first entry, as the file states it (CAMT `OPBD`/`PRCD`, MT940
	 * `:60F:`/`:60M:`); null when it states none.
	 */
	openingBalance: StatementBalance | null;
	/**
	 * The booked balance after the statement's last entry, as the file states it (CAMT `CLBD`, MT940 `:62F:`/`:62M:`,
	 * OFX `LEDGERBAL` dated on or after every entry); null when it states none.
	 */
	closingBalance: StatementBalance | null;
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
