import {normalizeIban} from '../../banking/own-transfer/iban';
import {readCsv} from './csv';
import {
	CsvByDirection,
	CsvDateFormat,
	CsvLayout,
	CsvTextEncoding,
	PENDING_SUFFIXES,
	csvLayoutColumnCount,
	decodeTable,
	isPendingWord,
} from './csv-layout';
import {CSV_LAYOUTS} from './csv-layouts';
import {isCalendarDate, serialDate} from './dates';
import {Decimal, amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal} from './parse-result';
import {rowsOfTable, withoutEmptyLines} from './table-sample';
import {isXlsx, readFirstSheet} from './xlsx';
import {isZip} from './zip-reader';

export type CsvLayoutRead = {
	layout: CsvLayout;
	statements: NormalizedStatement[];
	/**
	 * Owner's layouts only: when every date of the file reads both day first and month first, one date as written
	 * and as read, so the owner can check it. Null otherwise.
	 */
	dateCheck: {written: string; date: string} | null;
};

/** A table cell: its text, and whether a workbook stored it as a number. */
export type TableCell = {text: string; number: boolean};

export type CsvLayoutReadOptions = {
	/**
	 * The owner's saved layouts rather than Wisp's: tried newest first, a header that matches but whose rows do not
	 * read lets the next one try, and every read must be plausible (at least one row, not every amount zero, every
	 * date from 1990 to a year from `today`).
	 */
	owned?: boolean;
	/** `YYYY-MM-DD`; defaults to the current UTC day. */
	today?: string;
};

const BYTE_ORDER_MARK = /\ufeff/g;
const CURRENCY = /^[A-Z]{3}$/;
/** A time of day after the date, with seconds, AM or PM, and a UTC offset (`Z`, `+0000`, `+01:00`) as written. */
const TIME_OF_DAY = String.raw`(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s?[AaPp][Mm])?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)?`;
type DatePattern = {pattern: RegExp; order: [year: number, month: number, day: number]; shortYear?: true};
const MONTH = String.raw`(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)`;
const MONTH_NUMBERS: Record<string, string> = {
	jan: '01',
	feb: '02',
	mar: '03',
	apr: '04',
	may: '05',
	jun: '06',
	jul: '07',
	aug: '08',
	sep: '09',
	sept: '09',
	oct: '10',
	nov: '11',
	dec: '12',
};
const datePattern = (source: string, order: DatePattern['order'], shortYear?: true): DatePattern => ({
	pattern: new RegExp(`^${source}${TIME_OF_DAY}$`, 'i'),
	order,
	...(shortYear ? {shortYear} : {}),
});
const DATE_PATTERNS: Record<CsvDateFormat, DatePattern> = {
	'YYYY-MM-DD': datePattern(String.raw`(\d{4})-(\d{2})-(\d{2})`, [1, 2, 3]),
	YYYYMMDD: datePattern(String.raw`(\d{4})(\d{2})(\d{2})`, [1, 2, 3]),
	'DD-MM-YYYY': datePattern(String.raw`(\d{2})-(\d{2})-(\d{4})`, [3, 2, 1]),
	'DD/MM/YYYY': datePattern(String.raw`(\d{1,2})/(\d{1,2})/(\d{4})`, [3, 2, 1]),
	'MM/DD/YYYY': datePattern(String.raw`(\d{1,2})/(\d{1,2})/(\d{4})`, [3, 1, 2]),
	'DD.MM.YYYY': datePattern(String.raw`(\d{1,2})\.(\d{1,2})\.(\d{4})`, [3, 2, 1]),
	'YYYY/MM/DD': datePattern(String.raw`(\d{4})/(\d{1,2})/(\d{1,2})`, [1, 2, 3]),
	'DD-MM-YY': datePattern(String.raw`(\d{1,2})-(\d{1,2})-(\d{2})`, [3, 2, 1], true),
	'DD/MM/YY': datePattern(String.raw`(\d{1,2})/(\d{1,2})/(\d{2})`, [3, 2, 1], true),
	'MM/DD/YY': datePattern(String.raw`(\d{1,2})/(\d{1,2})/(\d{2})`, [3, 1, 2], true),
	'DD.MM.YY': datePattern(String.raw`(\d{1,2})\.(\d{1,2})\.(\d{2})`, [3, 2, 1], true),
	'DD MMM YYYY': datePattern(String.raw`(\d{1,2})[ -]${MONTH}[ -](\d{4})`, [3, 2, 1]),
	'DD MMM YY': datePattern(String.raw`(\d{1,2})[ -]${MONTH}[ -](\d{2})`, [3, 2, 1], true),
	'YYYY.MM.DD': datePattern(String.raw`(\d{4})\.(\d{1,2})\.(\d{1,2})\.?`, [1, 2, 3]),
};
/** Formats whose day-first and month-first readings are both supported, so a file can fit either. */
const SWAPPED_DATE_FORMATS: Partial<Record<CsvDateFormat, CsvDateFormat>> = {
	'DD/MM/YYYY': 'MM/DD/YYYY',
	'MM/DD/YYYY': 'DD/MM/YYYY',
	'DD/MM/YY': 'MM/DD/YY',
	'MM/DD/YY': 'DD/MM/YY',
};
const EARLIEST_PLAUSIBLE_DATE = '1990-01-01';
/** An amount with an optional currency symbol or code around it, and a sign, parentheses or a trailing minus. */
const STYLED_AMOUNT =
	/^(?<open>\()?\s*(?<lead>[+-])?\s*(?:(?:[A-Z]{3}|\p{Sc})\s*)?(?<sign>[+-])?\s*(?<number>\d[\d.,'\s]*?)\s*(?:(?:[A-Z]{3}|\p{Sc})\s*)?(?<trail>-)?\s*(?<close>\))?$/u;
/** A grouped IBAN (blocks of four) or a compact one, as statements print it above the table. */
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}(?:(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,4})?|[A-Z0-9]{11,30})\b/g;

/** A BIC (8 or 11 characters), a space and an IBAN written compact. */
const BIC_AND_IBAN = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\s+([A-Z]{2}\d{2}[A-Z0-9]{11,30})$/;

/** A row that does not read as its layout says; the reader turns it into the layout's refusal. */
class RowProblem extends Error {}

/** Rows that all read but name more than one account in the layout's one-account column. */
class SeveralAccounts extends Error {}

type ReadRow = NormalizedRow & {iban: string | null; units: bigint; balance: Decimal | null};
type Attempt = {read: CsvLayoutRead} | {nearMiss: string} | {skipsRows: true} | {severalAccounts: true} | null;

/**
 * Reads a file with the first layout that claims it, or returns null when none does. A layout with a header claims
 * a file whose header (and preamble) match; once claimed, every row must read and the running balance must follow
 * the amounts, or the file is refused with `layout_not_recognized` naming the layout. A layout without a header
 * claims a file only when all of it reads; otherwise the next layout is tried.
 *
 * With `owned`, a header that matches but whose rows do not read lets the next layout try; only when no layout
 * reads the file is it refused with `layout_not_recognized`, naming the first that matched. A layout whose skipped
 * lines above or below the table look like rows does not read the file either: when no other layout does, it is refused with
 * `layout_not_mappable` (before any near miss) rather than read without those rows. Rows that read but name more
 * than one account in the layout's one-account column are refused as `several_accounts`, by a layout that claimed
 * the file by its header or, with `owned`, when no other layout reads it.
 */
export function readCsvLayout(
	bytes: Uint8Array,
	layouts: readonly CsvLayout[] = CSV_LAYOUTS,
	options: CsvLayoutReadOptions = {},
): CsvLayoutRead | null {
	const source = new TableSource(bytes);
	const ordered = [
		...layouts.filter(({recognize}) => 'header' in recognize),
		...layouts.filter(({recognize}) => !('header' in recognize)),
	];
	let nearMiss: string | null = null;
	let skipsRows = false;
	let severalAccounts = false;
	for (const layout of ordered) {
		const attempt = attemptLayout(source, layout, options);
		if (!attempt) continue;
		if ('read' in attempt) return attempt.read;
		if ('skipsRows' in attempt) {
			skipsRows = true;
			continue;
		}
		if ('severalAccounts' in attempt) {
			if (!options.owned) throw new ParseRefusal('several_accounts');
			severalAccounts = true;
			continue;
		}
		if (!options.owned) throw new ParseRefusal('layout_not_recognized', attempt.nearMiss);
		nearMiss ??= attempt.nearMiss;
	}
	// Rows a layout would skip are the refusal to name, before a layout whose rows do not read.
	if (skipsRows) throw new ParseRefusal('layout_not_mappable');
	if (severalAccounts) throw new ParseRefusal('several_accounts');
	if (nearMiss) throw new ParseRefusal('layout_not_recognized', nearMiss);
	return null;
}

function attemptLayout(source: TableSource, layout: CsvLayout, options: CsvLayoutReadOptions): Attempt {
	const {recognize} = layout;
	const skipBefore = layout.skipBefore ?? 0;
	const workbook = layout.source === 'xlsx';
	const skipAfter = layout.skipAfter ?? 0;
	// Lines the layout skips above and below the table, none of which may be one of its rows (`rowsOfTable`).
	const skipped = (records: readonly TableCell[][], start: number) => {
		const texts = records.map((cells) => cells.map(({text}) => text));
		const end = texts.length - skipAfter;
		const rows = texts.slice(start, end);
		const outside = rowsOfTable(rows, Math.max(csvLayoutColumnCount(layout), ...rows.map(({length}) => length)));
		const above = 'header' in recognize ? outside.above : outside.below;
		return texts.slice(0, skipBefore).some(above) || texts.slice(Math.max(start, end)).some(outside.below);
	};
	if ('header' in recognize) {
		const expected = [...(recognize.preamble ?? []), recognize.header];
		const head = workbook ? source.workbookRows() : source.head(layout, skipBefore + expected.length);
		if (!head || !expected.every((row, index) => sameCells(head[skipBefore + index], row, workbook))) return null;
		const records = workbook ? head : source.records(layout);
		if (options.owned && records && skipped(records, skipBefore + expected.length)) return {skipsRows: true};
		const read = records && readTable(records, skipBefore + expected.length, layout, options);
		if (read === 'severalAccounts') return {severalAccounts: true};
		return read ? {read} : {nearMiss: layout.id};
	}
	const records = workbook ? source.workbookRows() : source.records(layout);
	const first = records?.[skipBefore];
	if (!records || !first) return null;
	// A workbook does not store the empty cells at a row's end, so its first row may be narrower.
	const width = rowWidth(first, workbook);
	if (workbook ? width > recognize.columnCount : width !== recognize.columnCount) return null;
	if (options.owned && skipped(records, skipBefore)) return {skipsRows: true};
	const read = readTable(records, skipBefore, layout, options);
	// A built-in layout without a header claims only a file it reads; an owned one reads the owner's own files.
	if (read === 'severalAccounts') return options.owned ? {severalAccounts: true} : null;
	return read ? {read} : null;
}

/**
 * The file's table, decoded or unpacked once per way a layout asks for. Text lines whose every cell is empty (a line
 * padded with delimiters) are no lines, as blank lines are not.
 */
class TableSource {
	private readonly texts = new Map<CsvTextEncoding, string | null>();
	private sheet?: TableCell[][] | null;
	private readonly parsed = new Map<string, TableCell[][] | null>();

	constructor(private readonly bytes: Uint8Array) {}

	/** The first rows for comparing a header: decoded leniently, so a near miss is still recognised as one. */
	head(layout: CsvLayout, rows: number): TableCell[][] | null {
		if (layout.source === 'xlsx') return null;
		const records = this.records(layout);
		if (records) return records.slice(0, rows);
		try {
			const text = new TextDecoder('utf-8').decode(this.bytes);
			return withoutEmptyLines(toCells(readCsv(text, {delimiter: layout.delimiter, quote: layout.quote}))).slice(
				0,
				rows,
			);
		} catch {
			return null;
		}
	}

	/** Every record of a text layout, decoded as its encoding says; null when the bytes are not in it. */
	records(layout: CsvLayout): TableCell[][] | null {
		if (layout.source === 'xlsx') return null;
		const key = JSON.stringify([layout.encoding, layout.delimiter, layout.quote]);
		if (!this.parsed.has(key)) {
			if (!this.texts.has(layout.encoding))
				this.texts.set(layout.encoding, decodeTable(this.bytes, layout.encoding));
			const text = this.texts.get(layout.encoding)!;
			let records: TableCell[][] | null = null;
			try {
				records =
					text === null
						? null
						: withoutEmptyLines(toCells(readCsv(text, {delimiter: layout.delimiter, quote: layout.quote})));
			} catch {
				records = null;
			}
			this.parsed.set(key, records);
		}
		return this.parsed.get(key)!;
	}

	/** The first sheet's rows, each without the empty cells at its end; null when the file is no workbook. */
	workbookRows(): TableCell[][] | null {
		if (this.sheet === undefined) {
			this.sheet =
				isZip(this.bytes) && isXlsx(this.bytes)
					? readFirstSheet(this.bytes).map((row) =>
							trimRow(row.map((cell) => ({text: cell?.value ?? '', number: cell?.type === 'number'}))),
						)
					: null;
		}
		return this.sheet;
	}
}

function toCells(records: string[][]): TableCell[][] {
	return records.map((record) => record.map((text) => ({text, number: false})));
}

function trimRow(row: TableCell[]): TableCell[] {
	let width = row.length;
	while (width > 0 && row[width - 1].text.trim() === '') width--;
	return row.slice(0, width);
}

function rowWidth(row: readonly TableCell[], workbook: boolean): number {
	return workbook ? trimRow([...row]).length : row.length;
}

/** Cells compared after trimming, case-folding and removing a byte order mark; a workbook's empty cells at the end do not count. */
function sameCells(actual: readonly TableCell[] | undefined, expected: readonly string[], workbook: boolean): boolean {
	if (!actual) return false;
	const fold = (cell: string) => cell.replace(BYTE_ORDER_MARK, '').trim().toLowerCase();
	const texts = actual.map(({text}) => text);
	const wanted = workbook ? trimRow(expected.map((text) => ({text, number: false}))).map(({text}) => text) : expected;
	const cells = workbook ? trimRow([...actual]).map(({text}) => text) : texts;
	return cells.length === wanted.length && cells.every((cell, index) => fold(cell) === fold(wanted[index]));
}

/**
 * The rows below line `start` (less the lines the layout skips at the end) read as the layout says; null when any
 * fails, `severalAccounts` when they read but name more than one account.
 */
function readTable(
	records: readonly TableCell[][],
	start: number,
	layout: CsvLayout,
	options: CsvLayoutReadOptions,
): CsvLayoutRead | 'severalAccounts' | null {
	const end = records.length - (layout.skipAfter ?? 0);
	if (end < start) return null;
	const lines = records.slice(start, end);
	const pending = (cells: readonly TableCell[]) =>
		(layout.pendingColumn !== undefined && isPendingWord(cells[layout.pendingColumn]?.text ?? '')) ||
		(layout.pendingSuffix !== undefined &&
			(cells[layout.pendingSuffix.column]?.text ?? '').endsWith(layout.pendingSuffix.text)) ||
		layout.description.some((column) =>
			PENDING_SUFFIXES.some((suffix) => (cells[column]?.text ?? '').trim().toLowerCase().endsWith(suffix)),
		);
	// A pending row is a row of the table all the same: one of another width is not skipped but refused.
	const width = rowWidthOf(lines);
	const body = lines.filter((cells) => !pending(cells) || !fitsRow(cells, layout, width));
	const statements = readRows(body, records.slice(0, layout.skipBefore ?? 0), layout, width);
	if (!statements || statements === 'severalAccounts') return statements;
	if (options.owned && !plausible(statements, options.today ?? new Date().toISOString().slice(0, 10))) return null;
	if (statements.length > 0) statements[0].entriesSkipped = lines.length - body.length;
	return {layout, statements, dateCheck: options.owned ? dateCheck(body, layout) : null};
}

/** At least one row, not every amount zero, and every date from 1990 to a year from today. */
function plausible(statements: readonly NormalizedStatement[], today: string): boolean {
	const rows = statements.flatMap(({rows}) => rows);
	const latest = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
	return (
		rows.length > 0 &&
		rows.some(({amount}) => /[1-9]/.test(amount)) &&
		rows.every((row) =>
			[row.bookingDate, row.valueDate, row.transactionDate].every(
				(date) => date === null || (date >= EARLIEST_PLAUSIBLE_DATE && date <= latest),
			),
		)
	);
}

/**
 * When the layout reads dates day first or month first and every date written as text also reads the other way,
 * the first that reads differently, as written and as read.
 */
function dateCheck(body: readonly TableCell[][], layout: CsvLayout): CsvLayoutRead['dateCheck'] {
	const swapped = SWAPPED_DATE_FORMATS[layout.dateFormat];
	if (!swapped) return null;
	const columns = [layout.bookingDate, layout.valueDate, layout.transactionDate].filter(
		(column): column is number => column !== undefined,
	);
	let example: CsvLayoutRead['dateCheck'] = null;
	for (const cells of body) {
		for (const column of columns) {
			const cell = cells[column];
			const written = cell?.text.trim();
			if (!cell || cell.number || !written) continue;
			const date = tryParseDate(written, layout.dateFormat);
			const other = tryParseDate(written, swapped);
			if (!date || !other) return null;
			if (!example && date !== other) example = {written, date};
		}
	}
	return example;
}

/**
 * The statements of the rows, one per account and currency in the order first met; null when any row fails, and
 * `severalAccounts` when they all read but differ in the column that must name one account.
 */
function readRows(
	records: readonly TableCell[][],
	above: readonly TableCell[][],
	layout: CsvLayout,
	/** The width of the whole table, pending rows included. */
	width: RowWidth,
): NormalizedStatement[] | 'severalAccounts' | null {
	let rows: ReadRow[];
	try {
		const lineIban = layout.accountIbanLine === undefined ? null : ibanOnLine(above[layout.accountIbanLine]);
		const debitsNegative = writesDebitsNegative(records, layout);
		rows = records.map((cells) => readRow(cells, layout, lineIban, debitsNegative, width));
		// Rows that read but name more than one account would mix those accounts in one statement; a row naming none,
		// such as a card statement's payment, names no other.
		const {oneAccountColumn} = layout;
		if (
			oneAccountColumn !== undefined &&
			new Set(records.map((cells) => (cells[oneAccountColumn]?.text ?? '').trim()).filter(Boolean)).size > 1
		) {
			throw new SeveralAccounts();
		}
	} catch (error) {
		if (error instanceof SeveralAccounts) return 'severalAccounts';
		if (error instanceof RowProblem) return null;
		throw error;
	}
	const groups = new Map<string, ReadRow[]>();
	for (const row of rows) {
		const key = JSON.stringify([row.iban, row.currency]);
		const group = groups.get(key);
		if (group) group.push(row);
		else groups.set(key, [row]);
	}
	const order = layout.balance ? balanceOrder([...groups.values()]) : 'file';
	if (!order) return null;
	return [...groups.values()].map((group) => ({
		format: 'csv',
		layout: layout.id,
		accountIban: group[0].iban,
		accountOtherId: null,
		// A file that names no account is told apart by its bank, as the owner named it.
		bank: group[0].iban ? null : layout.bank,
		servicerBic: null,
		accountCurrency: group[0].currency,
		sequenceNumber: null,
		entriesSkipped: 0,
		openingBalance: null,
		closingBalance: null,
		// In booking order: a file listing the newest first is turned around.
		rows: (order === 'reversed' ? [...group].reverse() : group).map(
			({iban: _iban, units: _units, balance: _balance, ...row}) => row,
		),
	}));
}

/** The one checksum-valid IBAN a line names; anything else is a row problem. */
function ibanOnLine(line: readonly TableCell[] | undefined): string {
	const text = (line ?? [])
		.map(({text}) => text)
		.join(' ')
		.toUpperCase();
	const ibans = new Set(
		[...text.matchAll(IBAN_IN_TEXT)].flatMap(([match]) => {
			const iban = normalizeIban(match);
			return iban ? [iban] : [];
		}),
	);
	if (ibans.size !== 1) throw new RowProblem();
	return [...ibans][0];
}

/**
 * Whether every account's balances follow its amounts in file order, or in reverse file order (a file listing the
 * newest first). One order holds for the whole file; null when neither does.
 */
function balanceOrder(groups: readonly ReadRow[][]): 'file' | 'reversed' | null {
	const follows = (group: readonly ReadRow[]) =>
		group.every((row, index) => index === 0 || row.balance!.units === group[index - 1].balance!.units + row.units);
	if (groups.every(follows)) return 'file';
	if (groups.every((group) => follows([...group].reverse()))) return 'reversed';
	return null;
}

/**
 * Whether the file writes its money out as negative numbers: every non-empty value of its money out column is zero
 * or negative. Decided once per file, before any row is read; false for other amount kinds.
 */
function writesDebitsNegative(records: readonly TableCell[][], layout: CsvLayout): boolean {
	const {amount} = layout;
	if (amount.kind !== 'debitCredit') return false;
	return records.every((row) => {
		const cell = row[amount.debitColumn];
		return !cell || cell.text.trim() === '' || parseAmount(cell, layout, true).units <= 0n;
	});
}

/**
 * Whether a row has the layout's width; a workbook does not store the empty cells at a row's end. A text row may end
 * in more empty cells than the header has (Sparda-Bank, mBank) when every row of the file has that same width
 * (`width`, null when they differ): one row longer than the rest is one shifted by a stray cell. A lone row may only
 * when the header does not end in an empty column.
 */
function fitsRow(row: readonly TableCell[], layout: CsvLayout, width: RowWidth): boolean {
	const columns = csvLayoutColumnCount(layout);
	if (layout.source === 'xlsx') return trimRow([...row]).length <= columns;
	if (row.length <= columns) return row.length === columns;
	const {recognize} = layout;
	const header = 'header' in recognize ? recognize.header : null;
	return (
		row.length === width.common &&
		trimRow([...row]).length <= columns &&
		(width.rows > 1 || (!!header && header[header.length - 1].trim() !== ''))
	);
}

/** The width every row of a table shares (null when they differ), and how many rows it has. */
type RowWidth = {common: number | null; rows: number};

function rowWidthOf(rows: readonly (readonly TableCell[])[]): RowWidth {
	const widths = new Set(rows.map(({length}) => length));
	return {common: widths.size === 1 ? [...widths][0] : null, rows: rows.length};
}

function readRow(
	row: readonly TableCell[],
	layout: CsvLayout,
	lineIban: string | null,
	debitsNegative: boolean,
	width: RowWidth,
): ReadRow {
	const {recognize} = layout;
	const columns = csvLayoutColumnCount(layout);
	const workbook = layout.source === 'xlsx';
	if (!fitsRow(row, layout, width)) throw new RowProblem();
	const cells = workbook ? Array.from({length: columns}, (_, index) => row[index] ?? {text: '', number: false}) : row;
	const cell = (column: number) => cells[column].text.trim();
	const optional = (column: number | undefined) => (column === undefined ? null : cell(column) || null);
	const date = (column: number | undefined) => (column === undefined ? null : readDate(cells[column], layout));
	// A value or transaction date may be left empty on some rows (card payments); the booking date may not.
	const optionalDate = (column: number | undefined) =>
		column === undefined || cell(column) === '' ? null : date(column);

	let iban: string | null = lineIban;
	if (layout.accountIban !== undefined) {
		iban = normalizeIban(cell(layout.accountIban));
		if (!iban) throw new RowProblem();
		if (
			!('header' in recognize) &&
			recognize.accountBankCodes &&
			!recognize.accountBankCodes.includes(iban.slice(4, 8))
		) {
			throw new RowProblem();
		}
	}
	const currency = 'fixed' in layout.currency ? layout.currency.fixed : cell(layout.currency.column);
	if (!CURRENCY.test(currency)) throw new RowProblem();
	if (moneyColumns(layout).some((column) => namesOtherCurrency(cells[column], currency))) throw new RowProblem();

	const amount = readAmount(cells, layout, debitsNegative);
	const stated = layout.balance ? parseAmount(cells[layout.balance.column], layout, true) : null;
	// The balance after the row, whichever side of it the file states.
	const balance =
		stated && layout.balance?.when === 'before'
			? {units: stated.units + amount.units, scale: stated.scale}
			: stated;
	const description = layout.description.map(cell).filter(Boolean).join(' ');

	return {
		iban,
		units: amount.units,
		balance,
		bookingDate: date(layout.bookingDate),
		valueDate: optionalDate(layout.valueDate),
		transactionDate: optionalDate(layout.transactionDate),
		amount: formatUnits(amount.units, amountScale(amount)),
		creditDebitIndicator: amount.units < 0n ? 'DBIT' : 'CRDT',
		currency,
		balanceAfter: balance && formatUnits(balance.units, amountScale(balance, amount)),
		bankReference: null,
		counterpartyName: optional(sideOf(layout.counterpartyName, amount.units)),
		counterpartyIban: counterpartyIban(optional(sideOf(layout.counterpartyIban, amount.units))),
		remittanceInformation: null,
		description: description || null,
		bankTransactionCode: optional(layout.bankTransactionCode),
		bankTransactionSubCode: null,
		referenceNumber: null,
	};
}

/** The columns a row reads money from: its amount, and its balance when the layout reads one. */
function moneyColumns(layout: CsvLayout): number[] {
	const {amount} = layout;
	const columns = amount.kind === 'debitCredit' ? [amount.debitColumn, amount.creditColumn] : [amount.column];
	return layout.balance ? [...columns, layout.balance.column] : columns;
}

/** Whether an amount cell writes a currency code other than the row's (`-12,50 EUR` on a row read as PLN). */
function namesOtherCurrency(cell: TableCell | undefined, currency: string): boolean {
	if (!cell || cell.number) return false;
	const code = /(?:^|[^A-Z])([A-Z]{3})(?![A-Z])/.exec(cell.text.trim())?.[1];
	return code !== undefined && code !== currency;
}

/** The column a row reads a field from: the one column, or its direction's. */
function sideOf(column: number | CsvByDirection | undefined, units: bigint): number | undefined {
	if (column === undefined || typeof column === 'number') return column;
	return units < 0n ? column.moneyOut : column.moneyIn;
}

/**
 * The row's signed amount, however the layout states it. `debitsNegative`: the file writes money out as negative
 * numbers (`writesDebitsNegative`).
 */
function readAmount(cells: readonly TableCell[], layout: CsvLayout, debitsNegative: boolean): Decimal {
	const {amount} = layout;
	if (amount.kind === 'signed') return parseAmount(cells[amount.column], layout, true);
	if (amount.kind === 'direction') {
		const unsigned = parseAmount(cells[amount.column], layout, false);
		const direction = cells[amount.directionColumn].text.trim();
		if (direction !== amount.debit.trim() && direction !== amount.credit.trim()) throw new RowProblem();
		return direction === amount.debit.trim() ? {...unsigned, units: -unsigned.units} : unsigned;
	}
	// Exactly one side filled; a zero on the other side counts as empty.
	const read = (cell: TableCell) => (cell.text.trim() === '' ? null : parseAmount(cell, layout, true));
	const debit = read(cells[amount.debitColumn]);
	const credit = read(cells[amount.creditColumn]);
	const filled = [debit, credit].filter((value) => value !== null && value.units !== 0n);
	if (filled.length > 1 || (debit === null && credit === null)) throw new RowProblem();
	// Money in is read by its sign as written, so a negative one (a reversal) is money out. Money out from a file that
	// writes it as negative numbers is money out by its size; otherwise v is -v, so a negative one among positive ones
	// (a reversal) is money in.
	if (debit && debit.units !== 0n) {
		return {units: debitsNegative ? debit.units : -debit.units, scale: debit.scale};
	}
	return credit ?? {units: 0n, scale: debit!.scale};
}

/**
 * An amount as the layout writes it: a plain decimal, or with `amountStyle` a thousands separator, a currency symbol
 * or code and parentheses or a trailing minus. A workbook number is read as the number it is. A sign only where the
 * layout writes one.
 */
function parseAmount(cell: TableCell, layout: CsvLayout, signed: boolean): Decimal {
	// A leading apostrophe is how a spreadsheet marks a number kept as text (Crédit Agricole Italia).
	const text = cell.text.trim().replace(/^'/, '');
	if (cell.number) {
		const number = Number(text);
		if (!Number.isFinite(number) || Math.abs(number) >= 1e15 || (!signed && number < 0)) throw new RowProblem();
		// Spreadsheet numbers are binary floats; eight decimals undo the rounding noise.
		const amount = parseDecimal(number.toFixed(8).replace(/\.?0+$/, ''), '.');
		if (!amount) throw new RowProblem();
		return amount;
	}
	if (!layout.amountStyle) {
		const amount = signed || !/^[+-]/.test(text) ? parseDecimal(text, layout.decimalMark) : null;
		if (!amount) throw new RowProblem();
		return amount;
	}
	const parts = STYLED_AMOUNT.exec(text)?.groups;
	if (!parts || !parts.open !== !parts.close || (parts.lead && parts.sign)) throw new RowProblem();
	const sign = parts.lead ?? parts.sign;
	const negatives = [sign === '-', !!parts.trail, !!parts.open].filter(Boolean).length;
	if (negatives > 1 || (sign === '+' && negatives > 0) || (!signed && (sign || negatives > 0))) {
		throw new RowProblem();
	}
	const amount = parseDecimal(ungroup(parts.number, layout), layout.decimalMark);
	if (!amount) throw new RowProblem();
	return negatives === 1 ? {...amount, units: -amount.units} : amount;
}

/** The number without its thousands separators, which must group the whole part in threes. */
function ungroup(number: string, layout: CsvLayout): string {
	const separator = layout.amountStyle?.thousandsSeparator ?? null;
	const decimal = layout.decimalMark;
	const [whole, ...fraction] = number.split(decimal);
	if (fraction.length > 1) throw new RowProblem();
	const groups = separator === ' ' ? whole.split(/[\s\u00a0\u202f]/) : separator ? whole.split(separator) : [whole];
	if (groups.length > 1 && !groups.every((group, index) => (index === 0 ? /^\d{1,3}$/ : /^\d{3}$/).test(group))) {
		throw new RowProblem();
	}
	return [groups.join(''), ...fraction].join(decimal);
}

/** A date cell: text in the layout's format, or a workbook's day serial. */
function readDate(cell: TableCell, layout: CsvLayout): string {
	if (cell.number) {
		const date = serialDate(Number(cell.text));
		if (!date) throw new RowProblem();
		return date;
	}
	const date = tryParseDate(cell.text.trim(), layout.dateFormat);
	if (!date) throw new RowProblem();
	return date;
}

function tryParseDate(text: string, format: CsvDateFormat, today = new Date()): string | null {
	const {pattern, order, shortYear} = DATE_PATTERNS[format];
	const parts = pattern.exec(text);
	if (!parts) return null;
	let year = parts[order[0]];
	if (shortYear) {
		// A two-digit year is the latest one that is not more than a year ahead.
		const full = 2000 + Number(year);
		year = String(full > today.getUTCFullYear() + 1 ? full - 100 : full);
	}
	const month = MONTH_NUMBERS[parts[order[1]].toLowerCase()] ?? parts[order[1]];
	const date = `${year}-${month.padStart(2, '0')}-${parts[order[2]].padStart(2, '0')}`;
	return isCalendarDate(date) ? date : null;
}

/**
 * Empty, or an old account number of digits only: none. A BIC and an IBAN in one cell, as Triodos writes them: the
 * IBAN. Anything else must be a valid IBAN.
 */
function counterpartyIban(value: string | null): string | null {
	const withBic = BIC_AND_IBAN.exec(value?.trim().toUpperCase() ?? '');
	if (withBic) {
		const iban = normalizeIban(withBic[1]);
		if (!iban) throw new RowProblem();
		return iban;
	}
	const compact = value?.replace(/\s+/g, '').toUpperCase();
	if (!compact || /^\d+$/.test(compact)) return null;
	const iban = normalizeIban(compact);
	if (!iban) throw new RowProblem();
	return iban;
}
