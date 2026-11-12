import {amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal, StatementFormat} from './parse-result';
import {XlsxCell, readFirstSheet} from './xlsx';

const REVOLUT_HEADER = [
	'Type',
	'Product',
	'Started Date',
	'Completed Date',
	'Description',
	'Amount',
	'Fee',
	'Currency',
	'State',
	'Balance',
] as const;
type RevolutColumn = (typeof REVOLUT_HEADER)[number];

const HEADER_LINE = REVOLUT_HEADER.join(',');
const BYTE_ORDER_MARK = '\ufeff';
const CSV_DATE = /^(\d{4}-\d{2}-\d{2}) \d{1,2}:\d{2}:\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const IMPORTED_PRODUCT = 'Current';
const IMPORTED_STATE = 'COMPLETED';
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** One row of a Revolut statement, read the way its source (CSV or workbook) stores each column. */
type RevolutRecord = {
	/** The cell as text; empty when the cell is. */
	text(column: RevolutColumn): string;
	/** The calendar date of a date-and-time cell, as written. */
	date(column: RevolutColumn): string;
	/** A decimal with a `.` separator; null when the cell is empty. */
	number(column: RevolutColumn): string | null;
};

/** The first line is Revolut's header (after an optional byte order mark). */
export function looksLikeRevolutCsv(bytes: Uint8Array): boolean {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, HEADER_LINE.length + 8))
		.toString('utf8')
		.replace(/^\ufeff/, '');
	return /^[^\r\n]*/.exec(head)?.[0] === HEADER_LINE;
}

/** Reads Revolut's CSV statement (UTF-8, CRLF, fields quoted when they hold a comma). */
export function parseRevolutCsv(bytes: Uint8Array): NormalizedStatement[] {
	let text: string;
	try {
		text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
	} catch {
		throw new ParseRefusal('parse_failed');
	}
	const [header, ...records] = readCsv(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text);
	if (header?.join(',') !== HEADER_LINE) throw new ParseRefusal('unsupported_format');
	return revolutStatements(
		records.map((cells) => {
			if (cells.length !== REVOLUT_HEADER.length) throw new ParseRefusal('parse_failed');
			const text = (column: RevolutColumn) => cells[REVOLUT_HEADER.indexOf(column)].trim();
			return {
				text,
				date: (column) => {
					const date = CSV_DATE.exec(text(column))?.[1];
					if (!date) throw new ParseRefusal('parse_failed');
					return date;
				},
				number: (column) => text(column) || null,
			};
		}),
		'revolutCsv',
	);
}

/**
 * Reads Revolut's Excel statement: the CSV's columns on the first sheet, dates as day serials (days since
 * 1899-12-30 with a time fraction) and amounts as numbers. A workbook laid out any other way is not supported.
 */
export function parseRevolutXlsx(bytes: Uint8Array): NormalizedStatement[] {
	const [header, ...rows] = readFirstSheet(bytes);
	const names = header?.map((cell) => (cell?.type === 'string' ? cell.value : null));
	if (names?.join(',') !== HEADER_LINE || names.length !== REVOLUT_HEADER.length) {
		throw new ParseRefusal('unsupported_format');
	}
	return revolutStatements(
		rows.map((cells) => {
			if (cells.length > REVOLUT_HEADER.length) throw new ParseRefusal('parse_failed');
			const cell = (column: RevolutColumn) => cells[REVOLUT_HEADER.indexOf(column)] ?? null;
			return {
				text: (column) => cell(column)?.value.trim() ?? '',
				date: (column) => serialDate(cell(column)),
				number: (column) => {
					const value = cell(column);
					if (value === null) return null;
					const number = value.type === 'number' ? Number(value.value) : Number.NaN;
					if (!Number.isFinite(number) || Math.abs(number) >= 1e15) throw new ParseRefusal('parse_failed');
					// Spreadsheet numbers are binary floats; eight decimals undo the rounding noise.
					return number.toFixed(8).replace(/\.?0+$/, '');
				},
			};
		}),
		'revolutXlsx',
	);
}

/** The calendar date of a day serial, rounded to the second first, with no time zone conversion. */
function serialDate(cell: XlsxCell | null): string {
	const days = cell?.type === 'number' ? Number(cell.value) : Number.NaN;
	if (!Number.isFinite(days) || days < 1 || days > 2_958_465) throw new ParseRefusal('parse_failed');
	return new Date(SERIAL_EPOCH_MS + Math.round(days * 86_400) * 1000).toISOString().slice(0, 10);
}

/**
 * One statement per currency, in the order the file first names it. Only completed rows of the current account
 * are imported, with the fee taken off the amount; every other row, and a row that moves nothing, is skipped and
 * counted. A currency without an imported row gives no statement.
 */
function revolutStatements(records: readonly RevolutRecord[], format: StatementFormat): NormalizedStatement[] {
	const statements = new Map<string, NormalizedStatement>();
	for (const record of records) {
		const currency = record.text('Currency');
		if (!CURRENCY.test(currency)) throw new ParseRefusal('parse_failed');
		const statement: NormalizedStatement = statements.get(currency) ?? {
			format,
			accountIban: null,
			accountOtherId: null,
			bank: 'Revolut',
			accountCurrency: currency,
			sequenceNumber: null,
			entriesSkipped: 0,
			rows: [],
		};
		statements.set(currency, statement);
		const row =
			record.text('Product') === IMPORTED_PRODUCT && record.text('State') === IMPORTED_STATE
				? revolutRow(record, currency)
				: null;
		if (row) statement.rows.push(row);
		else statement.entriesSkipped += 1;
	}
	return [...statements.values()].filter(({rows}) => rows.length > 0);
}

function revolutRow(record: RevolutRecord, currency: string): NormalizedRow | null {
	const amount = toDecimal(record.number('Amount'));
	const fee = toDecimal(record.number('Fee') ?? '0');
	const balanceText = record.number('Balance');
	const balance = balanceText === null ? null : toDecimal(balanceText);
	const units = amount.units - fee.units;
	if (units === 0n) return null;
	return {
		bookingDate: record.date('Started Date'),
		valueDate: record.date('Completed Date'),
		transactionDate: null,
		amount: formatUnits(units, amountScale(amount, fee)),
		creditDebitIndicator: units > 0n ? 'CRDT' : 'DBIT',
		currency,
		balanceAfter: balance && formatUnits(balance.units, amountScale(balance)),
		bankReference: null,
		counterpartyName: null,
		counterpartyIban: null,
		remittanceInformation: null,
		description: record.text('Description') || null,
		bankTransactionCode: null,
		bankTransactionSubCode: null,
		referenceNumber: null,
	};
}

function toDecimal(value: string | null) {
	const parsed = value === null ? null : parseDecimal(value, '.');
	if (!parsed) throw new ParseRefusal('parse_failed');
	return parsed;
}

/** RFC 4180 records: `"` quotes a field, `""` inside one is a quote; CRLF or LF ends a record. */
function readCsv(text: string): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (quoted) {
			if (character !== '"') field += character;
			else if (text[index + 1] === '"') {
				field += '"';
				index++;
			} else quoted = false;
		} else if (character === '"' && field === '') {
			quoted = true;
		} else if (character === ',') {
			record.push(field);
			field = '';
		} else if (character === '\n' || character === '\r') {
			if (character === '\r' && text[index + 1] === '\n') index++;
			record.push(field);
			if (record.length > 1 || record[0] !== '') records.push(record);
			record = [];
			field = '';
		} else {
			field += character;
		}
	}
	if (quoted) throw new ParseRefusal('parse_failed');
	record.push(field);
	if (record.length > 1 || record[0] !== '') records.push(record);
	return records;
}
