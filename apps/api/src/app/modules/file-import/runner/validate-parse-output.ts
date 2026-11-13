import {normalizeIban} from '@modules/banking/own-transfer/iban';

import {isCsvLayoutId} from '../parsers/csv-layout';
import {MAX_ARCHIVE_ENTRIES, MAX_ROWS_PER_DROP} from '../parsers/parse-limits';
import {
	NormalizedRow,
	NormalizedStatement,
	PARSE_REFUSAL_CODES,
	ParseRefusal,
	ParseRefusalCode,
	ParseResult,
	STATEMENT_BANKS,
	STATEMENT_FORMATS,
	StatementBank,
	StatementFormat,
} from '../parsers/parse-result';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^-?\d{1,15}(\.\d{1,8})?$/;
const CURRENCY = /^[A-Z]{3}$/;
// The column caps the transaction write path applies.
const TEXT_LIMITS = {
	bankReference: 255,
	counterpartyName: 255,
	remittanceInformation: 10_000,
	description: 500,
	bankTransactionCode: 64,
	bankTransactionSubCode: 64,
	referenceNumber: 255,
} as const;
const MAX_ACCOUNT_ID_LENGTH = 34;
const MAX_SEQUENCE_NUMBER_LENGTH = 32;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g;

export type ValidatedParseOutput =
	{ok: true; result: ParseResult} | {ok: false; code: ParseRefusalCode; layout?: string};

/**
 * Checks everything the parse child returned before any of it is used: the child parsed hostile input, so its
 * output is treated as hostile too. Anything unexpected is a `parse_failed` refusal.
 */
export function validateParseOutput(output: unknown): ValidatedParseOutput {
	const record = asRecord(output);
	if (record.ok === false) {
		const code = record.code;
		if (typeof code !== 'string' || !(PARSE_REFUSAL_CODES as readonly string[]).includes(code)) {
			throw new ParseRefusal('parse_failed');
		}
		// Only a near miss of a CSV layout names the layout, and it always does.
		if (code !== 'layout_not_recognized') {
			if (record.layout !== undefined) throw new ParseRefusal('parse_failed');
			return {ok: false, code: code as ParseRefusalCode};
		}
		if (!isCsvLayoutId(record.layout)) throw new ParseRefusal('parse_failed');
		return {ok: false, code, layout: record.layout};
	}
	if (record.ok !== true) throw new ParseRefusal('parse_failed');
	const files = record.files;
	if (typeof files !== 'number' || !Number.isInteger(files) || files < 1 || files > MAX_ARCHIVE_ENTRIES) {
		throw new ParseRefusal('parse_failed');
	}
	const formats = record.formats;
	if (
		!Array.isArray(formats) ||
		formats.length === 0 ||
		formats.length > files ||
		new Set(formats).size !== formats.length
	) {
		throw new ParseRefusal('parse_failed');
	}
	if (!Array.isArray(record.statements)) throw new ParseRefusal('parse_failed');

	const fileFormats = formats.map(validFormat);
	// The CSV layouts of the files read: at least one when a CSV file was read, none otherwise.
	const layouts = record.layouts;
	if (
		!Array.isArray(layouts) ||
		layouts.length > files ||
		new Set(layouts).size !== layouts.length ||
		!layouts.every(isCsvLayoutId) ||
		layouts.length > 0 !== fileFormats.includes('csv')
	) {
		throw new ParseRefusal('parse_failed');
	}
	let rowCount = 0;
	const statements = record.statements.map((value) => {
		const rows = asRecord(value).rows;
		if (!Array.isArray(rows)) throw new ParseRefusal('parse_failed');
		rowCount += rows.length;
		if (rowCount > MAX_ROWS_PER_DROP) throw new ParseRefusal('too_many_rows');
		const statement = validateStatement(value);
		// Every statement comes from one of the files read.
		if (!fileFormats.includes(statement.format)) throw new ParseRefusal('parse_failed');
		if (statement.layout !== null && !layouts.includes(statement.layout)) throw new ParseRefusal('parse_failed');
		return statement;
	});
	return {ok: true, result: {files, formats: fileFormats, layouts, statements}};
}

/** A statement names its account by IBAN or other id, or else, for a file that names none, by its bank. */
function validateStatement(value: unknown): NormalizedStatement {
	const statement = asRecord(value);
	const accountIban = statement.accountIban === null ? null : normalizeIban(asString(statement.accountIban));
	if (statement.accountIban !== null && !accountIban) throw new ParseRefusal('parse_failed');
	const accountOtherId = accountIban ? null : cleanText(statement.accountOtherId, MAX_ACCOUNT_ID_LENGTH, true);
	const bank = statement.bank;
	if (bank !== null && (!(STATEMENT_BANKS as readonly unknown[]).includes(bank) || accountIban || accountOtherId)) {
		throw new ParseRefusal('parse_failed');
	}
	if (!accountIban && !accountOtherId && !bank) throw new ParseRefusal('parse_failed');
	const entriesSkipped = statement.entriesSkipped;
	if (typeof entriesSkipped !== 'number' || !Number.isInteger(entriesSkipped) || entriesSkipped < 0) {
		throw new ParseRefusal('parse_failed');
	}
	const format = validFormat(statement.format);
	// A statement of a CSV file names its layout; no other statement does.
	const layout = statement.layout;
	if (format === 'csv' ? !isCsvLayoutId(layout) : layout !== null) throw new ParseRefusal('parse_failed');
	return {
		format,
		layout: layout as string | null,
		accountIban,
		accountOtherId,
		bank: bank as StatementBank | null,
		accountCurrency: validCurrency(statement.accountCurrency),
		sequenceNumber: cleanText(statement.sequenceNumber, MAX_SEQUENCE_NUMBER_LENGTH, true),
		entriesSkipped,
		rows: (statement.rows as unknown[]).map(validateRow),
	};
}

function validateRow(value: unknown): NormalizedRow {
	const row = asRecord(value);
	const amount = validAmount(row.amount);
	const creditDebitIndicator = row.creditDebitIndicator;
	if (creditDebitIndicator !== 'CRDT' && creditDebitIndicator !== 'DBIT') throw new ParseRefusal('parse_failed');
	const negative = amount.startsWith('-');
	const nonZero = /[1-9]/.test(amount);
	if (creditDebitIndicator === 'CRDT' ? negative : nonZero && !negative) throw new ParseRefusal('parse_failed');
	const counterpartyIban = row.counterpartyIban === null ? null : normalizeIban(asString(row.counterpartyIban));
	return {
		bookingDate: validDate(row.bookingDate),
		valueDate: validDate(row.valueDate),
		transactionDate: validDate(row.transactionDate),
		amount,
		creditDebitIndicator,
		currency: validCurrency(row.currency),
		balanceAfter: row.balanceAfter === null ? null : validAmount(row.balanceAfter),
		bankReference: cleanText(row.bankReference, TEXT_LIMITS.bankReference),
		counterpartyName: cleanText(row.counterpartyName, TEXT_LIMITS.counterpartyName),
		counterpartyIban,
		remittanceInformation: cleanText(row.remittanceInformation, TEXT_LIMITS.remittanceInformation),
		description: cleanText(row.description, TEXT_LIMITS.description),
		bankTransactionCode: cleanText(row.bankTransactionCode, TEXT_LIMITS.bankTransactionCode),
		bankTransactionSubCode: cleanText(row.bankTransactionSubCode, TEXT_LIMITS.bankTransactionSubCode),
		referenceNumber: cleanText(row.referenceNumber, TEXT_LIMITS.referenceNumber),
	};
}

function validFormat(value: unknown): StatementFormat {
	if (!(STATEMENT_FORMATS as readonly unknown[]).includes(value)) throw new ParseRefusal('parse_failed');
	return value as StatementFormat;
}

function validDate(value: unknown): string | null {
	if (value === null) return null;
	const date = asString(value);
	if (!DATE.test(date) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
		throw new ParseRefusal('parse_failed');
	}
	return date;
}

function validAmount(value: unknown): string {
	const amount = asString(value);
	if (!AMOUNT.test(amount)) throw new ParseRefusal('parse_failed');
	return amount;
}

function validCurrency(value: unknown): string {
	const currency = asString(value);
	if (!CURRENCY.test(currency)) throw new ParseRefusal('parse_failed');
	return currency;
}

/**
 * Text with control characters replaced by spaces, trimmed and length-capped. An identifier (`exact`) is refused
 * instead of cut, since a shortened id would name another account.
 */
function cleanText(value: unknown, maxLength: number, exact = false): string | null {
	if (value === null) return null;
	const text = asString(value).replace(CONTROL_CHARACTERS, ' ').trim();
	if (!text) return null;
	if (text.length <= maxLength) return text;
	if (exact) throw new ParseRefusal('parse_failed');
	return text.slice(0, maxLength);
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ParseRefusal('parse_failed');
	return value as Record<string, unknown>;
}

function asString(value: unknown): string {
	if (typeof value !== 'string') throw new ParseRefusal('parse_failed');
	return value;
}
