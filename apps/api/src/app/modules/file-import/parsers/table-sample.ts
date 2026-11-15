import {readCsv} from './csv';
import {
	CSV_DELIMITERS,
	CsvDelimiter,
	CsvTextEncoding,
	MAX_LAYOUT_COLUMNS,
	decodeTable,
	detectEncoding,
} from './csv-layout';
import {MaskedTable, maskTable} from './table-mask';
import {isXlsx, readFirstSheet} from './xlsx';
import {isZip} from './zip-reader';

/** Where a table sits in a file and how it is written, found without reading any of its values. */
export type TableShape =
	{source: 'text'; delimiter: CsvDelimiter; quote: '"' | "'"; encoding: CsvTextEncoding} | {source: 'xlsx'};

/** A file's table: where it is, and what the column mapper may see of it (`maskTable`). */
export type TableSample = {
	shape: TableShape;
	columnCount: number;
	/** Lines above the header, or above the first row when there is none. */
	skipBefore: number;
	/**
	 * Lines above the table that look like rows (`looksLikeRow`). A layout skipping them would drop them, so such a
	 * table is not mapped.
	 */
	rowsAbove: number;
	/** Lines below the last row. */
	skipAfter: number;
	/** Lines below the table that look like rows, such as a last row cut short; not mapped either. */
	rowsBelow: number;
	/** The header's cells as written, trimmed; null when the table has none. */
	header: string[] | null;
	rowCount: number;
	masked: MaskedTable;
};

/** Text characters that never appear in a statement: a file holding them is not a text table. */
const BINARY = /[\u0000-\u0008\u000e-\u001f]/;
const DIGIT = /\p{Nd}/u;
const LETTER = /\p{L}/u;

/**
 * Finds the table in a file: delimited text whose longest run of lines with one column count (two or more) is at
 * least two lines, or the first sheet of a workbook. Lines whose every cell is empty are no lines. Null for anything
 * else, and for a table that rows of its width follow below a line of another width (skipping the lines below it
 * would drop them). The rows start at the run's first line with a cell that looks like a value, past lines padded
 * out to the run's width that hold only a few cells (`padded`); the line right above it is the header when none of
 * its cells does, and lines of the run above the header are lines above the table. A header right above the run
 * that is narrower only by the empty cells the rows end in is the table's. Padded lines, and lines whose cell in a
 * date or amount column is no value, at the run's end are lines below it. A file whose first line looks like a row
 * has no header. Lines above and below the table that could be its rows are counted (`rowsAbove`, `rowsBelow`).
 */
export function sampleTable(bytes: Uint8Array): TableSample | null {
	const table = isZip(bytes) ? (isXlsx(bytes) ? workbookTable(bytes) : null) : textTable(bytes);
	if (!table) return null;
	const {shape, records} = table;
	const text = shape.source === 'text';
	const columnCount = Math.max(...records.slice(table.start, table.end).map((row) => row.length));
	if (columnCount < 2 || columnCount > MAX_LAYOUT_COLUMNS) return null;
	const padded = (row: readonly string[]) => text && paddedLine(row, columnCount);
	// Rows start below the run's last header that is not padding, as titles, account lines and balances may sit above it
	// in lines of the table's width; a line above it that could be a row is counted, not dropped (`rowsAbove`).
	const run = records.slice(table.start, table.end);
	const lastHeader = run.findLastIndex((row) => looksLikeHeader(row) && !padded(row));
	const firstRow = run.findIndex((row, index) => index > lastHeader && row.some(looksLikeValue) && !padded(row));
	if (firstRow === -1) return null;
	let end = table.end;
	// The last line is below the table when it is padding, or holds something else where the lines above it all hold
	// a value (`Kontostand` in the date column).
	while (
		end - 1 > table.start + firstRow &&
		(padded(records[end - 1]) ||
			!rowsOfTable(records.slice(table.start + firstRow, end - 1), columnCount).fitsValueColumns(
				records[end - 1],
			))
	) {
		end--;
	}
	const rows = records.slice(table.start + firstRow, end);
	const headerLine = table.start + firstRow - 1;
	const above = records[headerLine];
	const hasHeader =
		headerLine >= 0 &&
		looksLikeHeader(above) &&
		(firstRow > 0 || (text && above.length < columnCount && above.length >= Math.max(...rows.map(filledWidth))));
	const start = hasHeader ? headerLine : table.start + firstRow;
	const outside = rowsOfTable(rows, columnCount);
	if (records.slice(end).some((row) => row.length === columnCount && outside.below(row))) return null;
	const header = hasHeader ? records[headerLine].map((value) => value.replace(/\ufeff/g, '').trim()) : null;
	return {
		shape,
		columnCount,
		skipBefore: start,
		rowsAbove: records.slice(0, start).filter(outside.above).length,
		skipAfter: records.length - end,
		rowsBelow: records.slice(end).filter(outside.below).length,
		header,
		rowCount: rows.length,
		masked: maskTable({
			header,
			linesAbove: records.slice(0, start).map((cells, line) => ({line, cells})),
			rows,
			linesBelow: records.slice(end),
			columnCount,
		}),
	};
}

/** The number of cells up to the last one that holds something. */
function filledWidth(cells: readonly string[]): number {
	let width = cells.length;
	while (width > 0 && cells[width - 1].trim() === '') width--;
	return width;
}

/**
 * A line written out to the table's width that holds cells in less than half of it and does not look like a row, as
 * banks that pad every line with delimiters write their titles and balances (Postbank, Intesa Sanpaolo). A sparse
 * row (a date, an amount and a name, the rest empty) is no padding.
 */
function paddedLine(cells: readonly string[], columnCount: number): boolean {
	return cells.length >= columnCount && filledWidth(cells) * 2 <= columnCount && !looksLikeRow(cells);
}

/**
 * Which lines outside a table could be among its rows, a layout skipping them would drop: lines that look like rows
 * (`looksLikeRow`), less padded lines and lines whose cell in a column every row fills with a value (a date, an
 * amount) is something else, such as `Kontostand` on a balance line. Above the table, a line narrower than it (a
 * summary line of another table) is no row either; below it, one is (a row cut short).
 */
export function rowsOfTable(
	rows: readonly (readonly string[])[],
	columnCount: number,
): {
	above: (cells: readonly string[]) => boolean;
	below: (cells: readonly string[]) => boolean;
	fitsValueColumns: (cells: readonly string[]) => boolean;
} {
	const valueColumns = Array.from({length: columnCount}, (_, column) => column).filter((column) => {
		const filled = rows.map((row) => (row[column] ?? '').trim()).filter((cell) => cell !== '');
		return filled.length > 0 && filled.every(looksLikeValue);
	});
	const fitsValueColumns = (cells: readonly string[]) =>
		valueColumns.every((column) => {
			const cell = (cells[column] ?? '').trim();
			return cell === '' || looksLikeValue(cell);
		});
	const below = (cells: readonly string[]) =>
		looksLikeRow(cells) && !paddedLine(cells, columnCount) && fitsValueColumns(cells);
	return {above: (cells) => cells.length >= columnCount && below(cells), below, fitsValueColumns};
}

/**
 * A line that looks like a transaction row rather than a title, an account line or a header: two or more of its cells
 * look like values (a date and an amount, say).
 */
export function looksLikeRow(cells: readonly string[]): boolean {
	return cells.filter(looksLikeValue).length >= 2;
}

/** A cell with a digit and at most three letters, like an amount, a date or an account number. */
function looksLikeValue(cell: string): boolean {
	return DIGIT.test(cell) && (cell.match(/\p{L}/gu)?.length ?? 0) <= 3;
}

function looksLikeHeader(row: readonly string[]): boolean {
	return row.some((cell) => LETTER.test(cell.replace(/\ufeff/g, ''))) && !row.some(looksLikeValue);
}

type FoundTable = {shape: TableShape; records: string[][]; start: number; end: number};

function textTable(bytes: Uint8Array): FoundTable | null {
	const encoding = detectEncoding(bytes);
	const text = decodeTable(bytes, encoding);
	if (text === null || BINARY.test(text)) return null;
	let best: (FoundTable & {length: number; columns: number}) | null = null;
	for (const quote of ['"', "'"] as const) {
		for (const delimiter of CSV_DELIMITERS) {
			let records: string[][];
			try {
				records = withoutEmptyLines(readCsv(text, {delimiter, quote}));
			} catch {
				continue;
			}
			if (splitsQuotedCells(records, delimiter, quote) || joinsQuotedCells(records, delimiter, quote)) continue;
			const run = longestRun(records);
			if (!run) continue;
			const columns = records[run.start].length;
			const length = run.end - run.start;
			if (!best || length > best.length || (length === best.length && columns > best.columns)) {
				best = {shape: {source: 'text', delimiter, quote, encoding}, records, ...run, length, columns};
			}
		}
	}
	return best && {shape: best.shape, records: best.records, start: best.start, end: best.end};
}

/** The records less those whose every cell is empty, as a line padded with delimiters is: no line at all. */
export function withoutEmptyLines<T extends string | {text: string}>(records: T[][]): T[][] {
	return records.filter((cells) => cells.some((cell) => (typeof cell === 'string' ? cell : cell.text).trim() !== ''));
}

/**
 * Another delimiter is the file's: a cell holds a quote, that delimiter and a quote (`x";"y`), as quoted cells read
 * with the wrong delimiter come out.
 */
function joinsQuotedCells(records: readonly string[][], delimiter: string, quote: '"' | "'"): boolean {
	const joints = CSV_DELIMITERS.filter((other) => other !== delimiter).map((other) => `${quote}${other}${quote}`);
	return records.some((cells) => cells.some((cell) => joints.some((joint) => cell.includes(joint))));
}

/**
 * The other quote character is the file's: on a line that holds an even count of it, a cell starts with it and a
 * later cell ends with it, as `"23,40"` read with `'` as the quote does (it splits at the comma and keeps the quotes).
 * Cells that only start with it, such as Dutch `'t Hoekje`, do not count.
 */
function splitsQuotedCells(records: readonly string[][], delimiter: string, quote: '"' | "'"): boolean {
	const other = quote === '"' ? "'" : '"';
	return records.some((cells) => {
		if (cells.join(delimiter).split(other).length % 2 === 0) return false;
		const opened = cells.findIndex((cell) => cell.startsWith(other));
		return (
			opened !== -1 &&
			cells.slice(opened).some((cell, index) => cell.endsWith(other) && (index > 0 || cell.length > 1))
		);
	});
}

/**
 * The longest stretch (earliest on a tie) of at least two lines with the same number of cells, two or more, one of
 * which looks like a row: a stretch of title lines is no table.
 */
function longestRun(records: readonly string[][]): {start: number; end: number} | null {
	let best: {start: number; end: number} | null = null;
	let start = 0;
	for (let index = 1; index <= records.length; index++) {
		if (index < records.length && records[index].length === records[start].length) continue;
		if (
			records[start]?.length >= 2 &&
			index - start >= 2 &&
			(!best || index - start > best.end - best.start) &&
			records.slice(start, index).some(looksLikeRow)
		) {
			best = {start, end: index};
		}
		start = index;
	}
	return best;
}

/**
 * A workbook's first sheet: the table starts at the first of its widest rows and runs while rows hold at least two
 * cells. Its empty cells at a row's end are not stored.
 */
function workbookTable(bytes: Uint8Array): FoundTable | null {
	let sheet: ReturnType<typeof readFirstSheet>;
	try {
		sheet = readFirstSheet(bytes);
	} catch {
		return null;
	}
	const records = sheet.map((row) => {
		const cells = row.map((cell) => cell?.value ?? '');
		while (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
		return cells;
	});
	const width = Math.max(0, ...records.map((row) => row.length));
	if (width < 2) return null;
	const start = records.findIndex((row) => row.length === width);
	let end = start + 1;
	while (end < records.length && records[end].length >= 2) end++;
	if (end - start < 2) return null;
	return {shape: {source: 'xlsx'}, records, start, end};
}
