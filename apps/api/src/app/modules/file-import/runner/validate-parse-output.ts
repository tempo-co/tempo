import {normalizeIban} from '@modules/banking/own-transfer/iban';

import {CSV_DELIMITERS, CsvLayout, MAX_LAYOUT_COLUMNS, isCsvLayoutId} from '../parsers/csv-layout';
import {ISO_CURRENCY_CODES} from '../parsers/currency-codes';
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
	StatementFormat,
} from '../parsers/parse-result';
import {MAX_HEADER_CELL_LENGTH, MAX_MASKED_CELL_LENGTH} from '../parsers/table-mask';
import {TableSample, TableShape} from '../parsers/table-sample';
import {PreviewChildOutput, SampleChildOutput} from './parse-runner.protocol';

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
/** A masked cell: no letter but `a` and `A`, no digit but `9`. */
const MASKED = /^[^\p{L}\p{N}]*(?:[aA9][^\p{L}\p{N}]*)*$/u;
const MAX_DATE_CHECK_LENGTH = 64;

export type ValidatedParseOutput =
	{ok: true; result: ParseResult} | {ok: false; code: ParseRefusalCode; layout?: string};

/**
 * Checks everything the parse child returned before any of it is used: the child parsed hostile input, so its
 * output is treated as hostile too. Anything unexpected is a `parse_failed` refusal. `owned` are the owner's saved
 * layouts the child was given: a statement that names no account names one of their banks, or Revolut.
 */
export function validateParseOutput(output: unknown, owned: readonly CsvLayout[] = []): ValidatedParseOutput {
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
		const statement = validateStatement(value, owned);
		// Every statement comes from one of the files read.
		if (!fileFormats.includes(statement.format)) throw new ParseRefusal('parse_failed');
		if (statement.layout !== null && !layouts.includes(statement.layout)) throw new ParseRefusal('parse_failed');
		return statement;
	});
	return {ok: true, result: {files, formats: fileFormats, layouts, statements}};
}

/**
 * A statement names its account by IBAN or other id, or else, for a file that names none, by its bank: Revolut for
 * Revolut's own formats, or the bank of the owner's saved layout it was read with.
 */
function validateStatement(value: unknown, owned: readonly CsvLayout[]): NormalizedStatement {
	const statement = asRecord(value);
	const accountIban = statement.accountIban === null ? null : normalizeIban(asString(statement.accountIban));
	if (statement.accountIban !== null && !accountIban) throw new ParseRefusal('parse_failed');
	const accountOtherId = accountIban ? null : cleanText(statement.accountOtherId, MAX_ACCOUNT_ID_LENGTH, true);
	const bank = statement.bank;
	const format = validFormat(statement.format);
	// A statement of a CSV file names its layout; no other statement does.
	const layout = statement.layout;
	if (format === 'csv' ? !isCsvLayoutId(layout) : layout !== null) throw new ParseRefusal('parse_failed');
	const banks: readonly unknown[] =
		format === 'csv' ? owned.filter(({id}) => id === layout).map(({bank}) => bank) : STATEMENT_BANKS;
	if (bank !== null && (!banks.includes(bank) || accountIban || accountOtherId)) {
		throw new ParseRefusal('parse_failed');
	}
	if (!accountIban && !accountOtherId && !bank) throw new ParseRefusal('parse_failed');
	const entriesSkipped = statement.entriesSkipped;
	if (typeof entriesSkipped !== 'number' || !Number.isInteger(entriesSkipped) || entriesSkipped < 0) {
		throw new ParseRefusal('parse_failed');
	}
	return {
		format,
		layout: layout as string | null,
		accountIban,
		accountOtherId,
		bank: bank as string | null,
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

/**
 * Checks the table sample the child found before any of it is sent: its counts are within the layout limits, and
 * every cell the mapper sees is masked, except header cells, ISO currency codes and the short values without digits a
 * column like a direction column may send as written.
 */
export function validateSampleOutput(output: unknown): SampleChildOutput {
	const record = asRecord(output);
	if (record.ok === false) return refusalOf(record);
	if (record.ok !== true) throw new ParseRefusal('parse_failed');
	const sample = asRecord(record.sample);
	const columnCount = whole(sample.columnCount, 2, MAX_LAYOUT_COLUMNS);
	const header = sample.header === null ? null : textCells(sample.header, columnCount, Number.POSITIVE_INFINITY);
	const masked = asRecord(sample.masked);
	const maskedHeader =
		masked.header === null ? null : textCells(masked.header, columnCount, 2 * MAX_HEADER_CELL_LENGTH);
	if ((header === null) !== (maskedHeader === null)) throw new ParseRefusal('parse_failed');
	const plain = (cell: string) => MASKED.test(cell) || ISO_CURRENCY_CODES.has(cell);
	const rowCell = (cell: string) => plain(cell) || (cell.length <= 12 && !/\p{Nd}/u.test(cell));
	const maskedCells = (value: unknown, allowed: (cell: string) => boolean) => {
		// Lengths count characters, which a string longer than the basic plane holds two units of.
		const cells = textCells(value, MAX_LAYOUT_COLUMNS, 2 * MAX_MASKED_CELL_LENGTH);
		if (!cells.every(allowed)) throw new ParseRefusal('parse_failed');
		return cells;
	};
	const list = (value: unknown, max: number) => {
		if (!Array.isArray(value) || value.length > max) throw new ParseRefusal('parse_failed');
		return value as unknown[];
	};
	const validated: TableSample = {
		shape: tableShape(sample.shape),
		columnCount,
		skipBefore: whole(sample.skipBefore, 0, Number.MAX_SAFE_INTEGER),
		skipAfter: whole(sample.skipAfter, 0, Number.MAX_SAFE_INTEGER),
		header,
		rowCount: whole(sample.rowCount, 1, Number.MAX_SAFE_INTEGER),
		masked: {
			header: maskedHeader,
			linesAbove: list(masked.linesAbove, 10).map((value) => {
				const line = asRecord(value);
				return {line: whole(line.line, 0, Number.MAX_SAFE_INTEGER), cells: maskedCells(line.cells, plain)};
			}),
			rows: list(masked.rows, 3).map((row) => maskedCells(row, rowCell)),
			linesBelow: list(masked.linesBelow, 3).map((row) => maskedCells(row, plain)),
			columnShapes: maskedCells(masked.columnShapes, (cell) => MASKED.test(cell)),
		},
	};
	if (validated.masked.rows.some((row) => row.length > columnCount)) throw new ParseRefusal('parse_failed');
	if (validated.masked.columnShapes.length !== columnCount) throw new ParseRefusal('parse_failed');
	return {ok: true, sample: validated};
}

/** Checks the statements the child read with one proposed layout: they name its id, and its bank when no account. */
export function validatePreviewOutput(output: unknown, layout: CsvLayout): PreviewChildOutput {
	const record = asRecord(output);
	if (record.ok === false) {
		if (record.code === 'layout_not_mappable') return {ok: false, code: 'layout_not_mappable'};
		return refusalOf(record);
	}
	if (record.ok !== true || !Array.isArray(record.statements)) throw new ParseRefusal('parse_failed');
	let rowCount = 0;
	const statements = record.statements.map((value) => {
		const statement = validateStatement(value, [layout]);
		rowCount += statement.rows.length;
		if (rowCount > MAX_ROWS_PER_DROP) throw new ParseRefusal('too_many_rows');
		if (statement.format !== 'csv' || statement.layout !== layout.id) throw new ParseRefusal('parse_failed');
		return statement;
	});
	const check = record.dateCheck === null ? null : asRecord(record.dateCheck);
	const dateCheck = check && {
		written: cleanText(check.written, MAX_DATE_CHECK_LENGTH, true) ?? '',
		date: validDate(check.date) ?? '',
	};
	if (dateCheck && (!dateCheck.written || !dateCheck.date)) throw new ParseRefusal('parse_failed');
	return {ok: true, statements, dateCheck};
}

function refusalOf(record: Record<string, unknown>): {ok: false; code: ParseRefusalCode} {
	const code = record.code;
	if (typeof code !== 'string' || !(PARSE_REFUSAL_CODES as readonly string[]).includes(code) || 'layout' in record) {
		throw new ParseRefusal('parse_failed');
	}
	return {ok: false, code: code as ParseRefusalCode};
}

function tableShape(value: unknown): TableShape {
	const shape = asRecord(value);
	if (shape.source === 'xlsx' && Object.keys(shape).length === 1) return {source: 'xlsx'};
	if (
		shape.source !== 'text' ||
		Object.keys(shape).length !== 4 ||
		!(CSV_DELIMITERS as readonly unknown[]).includes(shape.delimiter) ||
		(shape.quote !== '"' && shape.quote !== "'") ||
		(shape.encoding !== 'utf-8' && shape.encoding !== 'windows-1252')
	) {
		throw new ParseRefusal('parse_failed');
	}
	return shape as TableShape;
}

function whole(value: unknown, min: number, max: number): number {
	if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
		throw new ParseRefusal('parse_failed');
	}
	return value as number;
}

function textCells(value: unknown, maxCells: number, maxLength: number): string[] {
	if (
		!Array.isArray(value) ||
		value.length > maxCells ||
		!value.every((cell) => typeof cell === 'string' && cell.length <= maxLength)
	) {
		throw new ParseRefusal('parse_failed');
	}
	return value as string[];
}
