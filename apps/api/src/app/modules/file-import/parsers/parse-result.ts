/** Refusals a parser can reach on its own; the parent adds size, timeout and account refusals. */
export const PARSE_REFUSAL_CODES = [
	'unsupported_format',
	'file_too_large',
	'archive_too_large',
	'too_many_files',
	'too_many_rows',
	'parse_failed',
] as const;
export type ParseRefusalCode = (typeof PARSE_REFUSAL_CODES)[number];

export class ParseRefusal extends Error {
	constructor(readonly code: ParseRefusalCode) {
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

export type NormalizedStatement = {
	/** The statement account's IBAN, or null when it is identified by another id. */
	accountIban: string | null;
	/** The account's other id (CAMT `Acct/Id/Othr/Id`) when it has no IBAN. */
	accountOtherId: string | null;
	accountCurrency: string;
	/** The statement's electronic sequence number, as written. */
	sequenceNumber: string | null;
	/** Entries left out because they are not booked. */
	entriesSkipped: number;
	rows: NormalizedRow[];
};

export type ParseResult = {
	format: 'camt053';
	/** Statement files read: 1 for a plain file, the entry count for an archive. */
	files: number;
	statements: NormalizedStatement[];
};

/** What the parse runner writes to stdout. */
export type ParseRunnerOutput = ({ok: true} & ParseResult) | {ok: false; code: ParseRefusalCode};
