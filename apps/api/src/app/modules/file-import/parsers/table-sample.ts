import {readCsv} from './csv';
import {CSV_DELIMITERS, CsvDelimiter, MAX_LAYOUT_COLUMNS} from './csv-layout';
import {MaskedTable, maskTable} from './table-mask';
import {isXlsx, readFirstSheet} from './xlsx';
import {isZip} from './zip-reader';

/** Where a table sits in a file and how it is written, found without reading any of its values. */
export type TableShape =
	{source: 'text'; delimiter: CsvDelimiter; quote: '"' | "'"; encoding: 'utf-8' | 'windows-1252'} | {source: 'xlsx'};

/** A file's table: where it is, and what the column mapper may see of it (`maskTable`). */
export type TableSample = {
	shape: TableShape;
	columnCount: number;
	/** Lines above the header, or above the first row when there is none. */
	skipBefore: number;
	/** Lines below the last row. */
	skipAfter: number;
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
 * least two lines, or the first sheet of a workbook. Null for anything else, and for a table that rows of its width
 * follow below a line of another width (skipping the lines below it would drop them). The rows start at the run's
 * first line with a cell that looks like a value; the line right above it is the header when none of its cells
 * does, and lines of the run above the header are lines above the table. A file whose first line looks like a row
 * has no header.
 */
export function sampleTable(bytes: Uint8Array): TableSample | null {
	const table = isZip(bytes) ? (isXlsx(bytes) ? workbookTable(bytes) : null) : textTable(bytes);
	if (!table) return null;
	const {shape, records, end} = table;
	const columnCount = Math.max(...records.slice(table.start, end).map((row) => row.length));
	if (columnCount < 2 || columnCount > MAX_LAYOUT_COLUMNS) return null;
	const firstRow = records.slice(table.start, end).findIndex((row) => row.some(looksLikeValue));
	if (firstRow === -1) return null;
	const headerLine = table.start + firstRow - 1;
	const hasHeader = firstRow > 0 && looksLikeHeader(records[headerLine]);
	const start = hasHeader ? headerLine : table.start + firstRow;
	const rows = records.slice(table.start + firstRow, end);
	if (records.slice(end).some((row) => row.length === columnCount && row.some(looksLikeValue))) return null;
	const header = hasHeader ? records[headerLine].map((value) => value.replace(/\ufeff/g, '').trim()) : null;
	return {
		shape,
		columnCount,
		skipBefore: start,
		skipAfter: records.length - end,
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

/** A cell with a digit and at most three letters, like an amount, a date or an account number. */
function looksLikeValue(cell: string): boolean {
	return DIGIT.test(cell) && (cell.match(/\p{L}/gu)?.length ?? 0) <= 3;
}

function looksLikeHeader(row: readonly string[]): boolean {
	return row.some((cell) => LETTER.test(cell.replace(/\ufeff/g, ''))) && !row.some(looksLikeValue);
}

type FoundTable = {shape: TableShape; records: string[][]; start: number; end: number};

function textTable(bytes: Uint8Array): FoundTable | null {
	let text: string;
	let encoding: 'utf-8' | 'windows-1252';
	try {
		text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
		encoding = 'utf-8';
	} catch {
		text = new TextDecoder('windows-1252').decode(bytes);
		encoding = 'windows-1252';
	}
	if (BINARY.test(text)) return null;
	let best: (FoundTable & {length: number; columns: number}) | null = null;
	for (const quote of ['"', "'"] as const) {
		for (const delimiter of CSV_DELIMITERS) {
			let records: string[][];
			try {
				records = readCsv(text, {delimiter, quote});
			} catch {
				continue;
			}
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

/** The longest stretch (earliest on a tie) of at least two lines with the same number of cells, two or more. */
function longestRun(records: readonly string[][]): {start: number; end: number} | null {
	let best: {start: number; end: number} | null = null;
	let start = 0;
	for (let index = 1; index <= records.length; index++) {
		if (index < records.length && records[index].length === records[start].length) continue;
		if (records[start]?.length >= 2 && index - start >= 2 && (!best || index - start > best.end - best.start)) {
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
