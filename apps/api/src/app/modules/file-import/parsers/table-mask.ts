import {MAX_LAYOUT_COLUMNS} from './csv-layout';
import {ISO_CURRENCY_CODES} from './currency-codes';

/** A file's table as found, before masking: every cell as written. */
export type FoundTableParts = {
	/** The header's cells, or null when the table has none. */
	header: readonly string[] | null;
	/** The lines above the table, with their 0-based line numbers in the file. */
	linesAbove: readonly {line: number; cells: readonly string[]}[];
	/** Every row of the table. */
	rows: readonly (readonly string[])[];
	linesBelow: readonly (readonly string[])[];
	columnCount: number;
};

/** What the column mapper is sent, and the shapes stored with a proposal. */
export type MaskedTable = {
	header: string[] | null;
	/** Up to 10 lines just above the table. */
	linesAbove: {line: number; cells: string[]}[];
	/** The first, middle and last rows. */
	rows: string[][];
	/** Up to 3 lines just below the table. */
	linesBelow: string[][];
	/** Each column's first value, masked without exceptions. */
	columnShapes: string[];
	/** Per column, what the whole column shows that three sampled rows can hide; shapes only, no content. */
	columns: ColumnHint[];
};

export type ColumnHint = {
	/** Up to 6 distinct values of the column over the whole table, masked without exceptions, most frequent first. */
	shapes: string[];
	/** Every non-empty cell holds one value, over at least 3 rows (such as the account holder's own IBAN). */
	sameValue: boolean;
};

export const MAX_MASKED_CELL_LENGTH = 60;
export const MAX_HEADER_CELL_LENGTH = 80;
const MAX_HEADER_CELLS = 200;
const MAX_LINES_ABOVE = 10;
const MAX_LINES_BELOW = 3;
const MAX_PLAIN_VALUES = 4;
const MAX_PLAIN_VALUE_LENGTH = 12;
export const MAX_COLUMN_SHAPES = 6;
const MIN_SAME_VALUE_ROWS = 3;

/**
 * Everything the column mapper may learn about a file, decided in this one place.
 *
 * - Every letter becomes `a` or `A` (case kept) and every digit `9`; punctuation, spaces and length are kept, and each
 *   cell is cut at 60 characters.
 * - Sent as written: the header's cells without a digit (cut at 80 characters, at most 200 of them); a cell that is
 *   an ISO 4217 currency code; and the values of a column that has at most four distinct ones over the whole table,
 *   each at most 12 characters without a digit, one of them written more than once (a direction column like
 *   `Af`/`Bij`). A column whose every value is written once, such as the names in a three-row file, stays masked.
 * - Only the first, middle and last rows, the 10 lines just above the table and the 3 just below it.
 * - Per column, over the whole table: up to 6 distinct values masked without exceptions, most frequent first (the
 *   empty one kept when the column has empty cells), and whether every non-empty cell holds the same value.
 */
export function maskTable(table: FoundTableParts): MaskedTable {
	const {rows, columnCount} = table;
	const plainValues = Array.from({length: columnCount}, (_, column) => plainColumnValues(rows, column));
	const cellOf = (row: readonly string[], column: number) => (row[column] ?? '').trim();
	const maskLine = (line: readonly string[]) =>
		line.slice(0, MAX_LAYOUT_COLUMNS).map((value) => maskCell(value.trim()));
	const sampled = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]
		.filter((index) => index >= 0 && index < rows.length)
		.map((index) => rows[index]);
	return {
		header:
			table.header &&
			table.header
				.slice(0, MAX_HEADER_CELLS)
				// A heading never needs a digit; a cell with one (an account number in a title line) is masked.
				.map((value) =>
					/\p{Nd}/u.test(value) ? maskText(value) : [...value].slice(0, MAX_HEADER_CELL_LENGTH).join(''),
				),
		linesAbove: table.linesAbove.slice(-MAX_LINES_ABOVE).map(({line, cells}) => ({line, cells: maskLine(cells)})),
		rows: sampled.map((row) =>
			row.slice(0, columnCount).map((_, column) => {
				const value = cellOf(row, column);
				return plainValues[column].has(value) ? value : maskCell(value);
			}),
		),
		linesBelow: table.linesBelow.slice(0, MAX_LINES_BELOW).map(maskLine),
		columnShapes: Array.from({length: columnCount}, (_, column) => maskText(cellOf(rows[0] ?? [], column))),
		columns: Array.from({length: columnCount}, (_, column) => columnHint(rows.map((row) => cellOf(row, column)))),
	};
}

/** What one column shows over the whole table: its distinct masked shapes and whether it holds one value. */
function columnHint(values: readonly string[]): ColumnHint {
	// A Map keeps insertion order, so equally frequent shapes stay in the order they first appear.
	const counts = new Map<string, number>();
	for (const value of values) {
		// Every numeric character, not only decimal digits (², ½), since these shapes cover every row of the file.
		const shape = maskText(value).replace(/\p{N}/gu, '9');
		counts.set(shape, (counts.get(shape) ?? 0) + 1);
	}
	const shapes = [...counts.keys()]
		.sort((left, right) => counts.get(right)! - counts.get(left)!)
		.slice(0, MAX_COLUMN_SHAPES);
	if (counts.has('') && !shapes.includes('')) shapes[shapes.length - 1] = '';
	const filled = new Set(values.filter((value) => value !== ''));
	return {shapes, sameValue: values.length >= MIN_SAME_VALUE_ROWS && filled.size === 1};
}

/** A cell outside the plain values: an ISO currency code as it is, anything else masked. */
function maskCell(value: string): string {
	return ISO_CURRENCY_CODES.has(value) ? value : maskText(value);
}

function maskText(text: string): string {
	return [...text]
		.slice(0, MAX_MASKED_CELL_LENGTH)
		.map((character) => {
			if (/\p{Nd}/u.test(character)) return '9';
			if (!/\p{L}/u.test(character)) return character;
			return character === character.toLowerCase() && character !== character.toUpperCase() ? 'a' : 'A';
		})
		.join('');
}

function plainColumnValues(rows: readonly (readonly string[])[], column: number): Set<string> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const value = (row[column] ?? '').trim();
		if (value === '') continue;
		counts.set(value, (counts.get(value) ?? 0) + 1);
		if (counts.size > MAX_PLAIN_VALUES) return new Set();
	}
	// A column of few short values, one of them written more than once, like a direction column; a column whose
	// every value is written once (a few names in a short file) stays masked.
	const plain =
		[...counts.values()].some((count) => count >= 2) &&
		[...counts.keys()].every((value) => value.length <= MAX_PLAIN_VALUE_LENGTH && !/\p{Nd}/u.test(value));
	return plain ? new Set(counts.keys()) : new Set();
}
