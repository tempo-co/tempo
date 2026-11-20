import {readCsv} from './csv';
import {checkedDate, serialDate} from './dates';
import {AMOUNT_SCALE, amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal, StatementFormat} from './parse-result';
import {readFirstSheet} from './xlsx';

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
	const [header, ...records] = readCsv(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text, {
		delimiter: ',',
		quote: '"',
	});
	if (header?.join(',') !== HEADER_LINE) throw new ParseRefusal('unsupported_format');
	return revolutStatements(
		records.map((cells) => {
			if (cells.length !== REVOLUT_HEADER.length) throw new ParseRefusal('parse_failed');
			const text = (column: RevolutColumn) => cells[REVOLUT_HEADER.indexOf(column)].trim();
			return {
				text,
				date: (column) => {
					return checkedDate(CSV_DATE.exec(text(column))?.[1] ?? '');
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
				date: (column) => {
					const value = cell(column);
					const date = value?.type === 'number' ? serialDate(Number(value.value)) : null;
					if (date === null) throw new ParseRefusal('parse_failed');
					return date;
				},
				number: (column) => {
					const value = cell(column);
					if (value === null || (value.type === 'string' && value.value.trim() === '')) return null;
					if (value.type !== 'number') throw new ParseRefusal('parse_failed');
					return spreadsheetNumber(value.value.trim());
				},
			};
		}),
		'revolutXlsx',
	);
}

/**
 * A cell's number as a decimal of at most eight places. Spreadsheets store binary floats written out in full
 * (`195.49999999999997`, `1.0000000001E8`), so the written digits are rounded half up at the eighth place, never
 * through a float.
 */
function spreadsheetNumber(written: string): string {
	const [, sign, whole, fraction = '', exponent = '0'] =
		/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,3}))?$/.exec(written) ?? [];
	if (whole === undefined || whole + fraction === '') throw new ParseRefusal('parse_failed');
	// The digits with the point moved by the exponent, as whole units and a fraction.
	const digits = whole + fraction;
	const point = whole.length + Number(exponent);
	const padded = point < 0 ? '0'.repeat(-point) + digits : digits.padEnd(point, '0');
	const pointIndex = Math.max(point, 0);
	const integer = padded.slice(0, pointIndex).replace(/^0+(?=\d)/, '') || '0';
	if (integer.length > 15) throw new ParseRefusal('parse_failed');
	const withRoundingDigit = BigInt(
		integer + padded.slice(pointIndex, pointIndex + AMOUNT_SCALE + 1).padEnd(AMOUNT_SCALE + 1, '0'),
	);
	const units = (withRoundingDigit + 5n) / 10n;
	return formatUnits(sign === '-' ? -units : units, AMOUNT_SCALE).replace(/\.?0+$/, '');
}

/**
 * One statement per currency, in the order the file first names it. Only completed rows of the current account
 * are imported, with the fee taken off the amount; every other row, and a row that moves nothing, is skipped and
 * counted. A currency without an imported row gives no statement.
 *
 * Each product keeps a running balance per currency over its completed rows, so a file whose rows were altered, added
 * or removed is refused: in file order, every completed row must state a balance, and each after the first must be
 * the one before it plus the amount less the fee. Rows of other states (pending, reverted) state no balance and are left
 * out of the chain.
 */
function revolutStatements(records: readonly RevolutRecord[], format: StatementFormat): NormalizedStatement[] {
	const statements = new Map<string, NormalizedStatement>();
	const balances = new Map<string, bigint>();
	for (const record of records) {
		const currency = record.text('Currency');
		if (!CURRENCY.test(currency)) throw new ParseRefusal('parse_failed');
		const statement: NormalizedStatement = statements.get(currency) ?? {
			format,
			layout: null,
			accountIban: null,
			accountOtherId: null,
			bank: 'Revolut',
			accountCurrency: currency,
			sequenceNumber: null,
			entriesSkipped: 0,
			openingBalance: null,
			closingBalance: null,
			rows: [],
		};
		statements.set(currency, statement);
		checkRunningBalance(balances, record, currency);
		const row =
			record.text('Product') === IMPORTED_PRODUCT && record.text('State') === IMPORTED_STATE
				? revolutRow(record, currency)
				: null;
		if (row) statement.rows.push(row);
		else statement.entriesSkipped += 1;
	}
	return [...statements.values()].filter(({rows}) => rows.length > 0);
}

/**
 * Refuses a completed row whose balance is missing or is not the previous one of its product and currency plus its
 * movement, and a row of another state that states a balance.
 */
function checkRunningBalance(balances: Map<string, bigint>, record: RevolutRecord, currency: string): void {
	if (record.text('State') !== IMPORTED_STATE) {
		// Revolut states no balance for a row that has not completed; one that does was edited.
		if (record.number('Balance') !== null) throw new ParseRefusal('parse_failed');
		return;
	}
	const balance = toDecimal(record.number('Balance')).units;
	const chain = JSON.stringify([record.text('Product'), currency]);
	const previous = balances.get(chain);
	if (previous !== undefined && previous + movement(record) !== balance) throw new ParseRefusal('parse_failed');
	balances.set(chain, balance);
}

/** The row's amount less its fee, in units. */
function movement(record: RevolutRecord): bigint {
	return toDecimal(record.number('Amount')).units - toDecimal(record.number('Fee') ?? '0').units;
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
