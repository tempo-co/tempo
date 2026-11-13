import {normalizeIban} from '../../banking/own-transfer/iban';
import {readCsv} from './csv';
import {CsvDateFormat, CsvLayout} from './csv-layout';
import {CSV_LAYOUTS} from './csv-layouts';
import {isCalendarDate} from './dates';
import {Decimal, amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal} from './parse-result';

export type CsvLayoutRead = {layout: CsvLayout; statements: NormalizedStatement[]};

const BYTE_ORDER_MARK = /\ufeff/g;
const CURRENCY = /^[A-Z]{3}$/;
const DATE_PATTERNS: Record<CsvDateFormat, {pattern: RegExp; order: [year: number, month: number, day: number]}> = {
	'YYYY-MM-DD': {pattern: /^(\d{4})-(\d{2})-(\d{2})$/, order: [1, 2, 3]},
	YYYYMMDD: {pattern: /^(\d{4})(\d{2})(\d{2})$/, order: [1, 2, 3]},
	'DD-MM-YYYY': {pattern: /^(\d{2})-(\d{2})-(\d{4})$/, order: [3, 2, 1]},
};

/** A row that does not read as its layout says; the reader turns it into the layout's refusal. */
class RowProblem {}

type ReadRow = NormalizedRow & {iban: string; units: bigint; balance: Decimal | null};

/**
 * Reads a file with the first layout that claims it, or returns null when none does. A layout with a header claims
 * a file whose header (and preamble) match; once claimed, every row must read and the running balance must follow
 * the amounts, or the file is refused with `layout_not_recognized` naming the layout. A layout without a header
 * claims a file only when all of it reads; otherwise the next layout is tried.
 */
export function readCsvLayout(bytes: Uint8Array, layouts: readonly CsvLayout[] = CSV_LAYOUTS): CsvLayoutRead | null {
	const texts = new DecodedText(bytes);
	const ordered = [
		...layouts.filter(({recognize}) => 'header' in recognize),
		...layouts.filter(({recognize}) => !('header' in recognize)),
	];
	for (const layout of ordered) {
		const {recognize} = layout;
		const dialect = {delimiter: layout.delimiter, quote: layout.quote};
		if ('header' in recognize) {
			const expected = [...(recognize.preamble ?? []), recognize.header];
			const head = readHead(texts.lenient(layout.encoding), dialect, expected.length);
			if (!head || !expected.every((row, index) => sameCells(head[index], row))) continue;
			const text = texts.strict(layout.encoding);
			const records = text === null ? null : readRecords(text, dialect);
			const statements = records && readRows(records.slice(expected.length), layout);
			if (!statements) throw new ParseRefusal('layout_not_recognized', layout.id);
			return {layout, statements};
		}
		const text = texts.strict(layout.encoding);
		const first = text === null ? null : readHead(text, dialect, 1);
		if (first?.[0]?.length !== recognize.columnCount) continue;
		const records = readRecords(text!, dialect);
		const statements = records && records.length > 0 ? readRows(records, layout) : null;
		if (statements) return {layout, statements};
	}
	return null;
}

/** The file's text, decoded once per way a layout asks for. */
class DecodedText {
	private utf8?: string | null;
	private windows1252?: string;

	constructor(private readonly bytes: Uint8Array) {}

	/** The text for comparing a header: never fails, so a near miss is still recognised as one. */
	lenient(encoding: CsvLayout['encoding']): string {
		return this.strict(encoding) ?? new TextDecoder('utf-8').decode(this.bytes);
	}

	/** The text as the layout's encoding reads it, or null when the bytes are not in it. */
	strict(encoding: CsvLayout['encoding']): string | null {
		if (this.utf8 === undefined) {
			try {
				this.utf8 = new TextDecoder('utf-8', {fatal: true}).decode(this.bytes);
			} catch {
				this.utf8 = null;
			}
		}
		if (this.utf8 !== null || encoding === 'utf-8') return this.utf8;
		this.windows1252 ??= new TextDecoder('windows-1252').decode(this.bytes);
		return this.windows1252;
	}
}

function readHead(text: string, dialect: {delimiter: string; quote: string}, rows: number): string[][] | null {
	try {
		return readCsv(text, dialect, rows);
	} catch {
		return null;
	}
}

function readRecords(text: string, dialect: {delimiter: string; quote: string}): string[][] | null {
	try {
		return readCsv(text, dialect);
	} catch {
		return null;
	}
}

function sameCells(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
	const fold = (cell: string) => cell.replace(BYTE_ORDER_MARK, '').trim().toLowerCase();
	return actual?.length === expected.length && actual.every((cell, index) => fold(cell) === fold(expected[index]));
}

/** The statements of the rows, one per account and currency in the order first met; null when any row fails. */
function readRows(records: readonly string[][], layout: CsvLayout): NormalizedStatement[] | null {
	let rows: ReadRow[];
	try {
		rows = records.map((cells) => readRow(cells, layout));
	} catch (error) {
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
		bank: null,
		accountCurrency: group[0].currency,
		sequenceNumber: null,
		entriesSkipped: 0,
		// In booking order: a file listing the newest first is turned around.
		rows: (order === 'reversed' ? [...group].reverse() : group).map(
			({iban: _iban, units: _units, balance: _balance, ...row}) => row,
		),
	}));
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

function readRow(cells: readonly string[], layout: CsvLayout): ReadRow {
	const {recognize} = layout;
	const columns = 'header' in recognize ? recognize.header.length : recognize.columnCount;
	if (cells.length !== columns) throw new RowProblem();
	const cell = (column: number) => cells[column].trim();
	const optional = (column: number | undefined) => (column === undefined ? null : cell(column) || null);
	const date = (column: number | undefined) =>
		column === undefined ? null : parseDate(cell(column), layout.dateFormat);

	const iban = normalizeIban(cell(layout.accountIban));
	if (!iban) throw new RowProblem();
	if (!('header' in recognize) && !recognize.accountBankCodes.includes(iban.slice(4, 8))) throw new RowProblem();
	const currency = 'fixed' in layout.currency ? layout.currency.fixed : cell(layout.currency.column);
	if (!CURRENCY.test(currency)) throw new RowProblem();

	const {amount: amountLayout} = layout;
	let amount: Decimal;
	if (amountLayout.kind === 'signed') {
		amount = parseAmount(cell(amountLayout.column), layout.decimalMark, true);
	} else {
		const unsigned = parseAmount(cell(amountLayout.column), layout.decimalMark, false);
		const direction = cell(amountLayout.directionColumn);
		if (direction !== amountLayout.debit && direction !== amountLayout.credit) throw new RowProblem();
		amount = direction === amountLayout.debit ? {...unsigned, units: -unsigned.units} : unsigned;
	}
	const stated = layout.balance ? parseAmount(cell(layout.balance.column), layout.decimalMark, true) : null;
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
		valueDate: date(layout.valueDate),
		transactionDate: date(layout.transactionDate),
		amount: formatUnits(amount.units, amountScale(amount)),
		creditDebitIndicator: amount.units < 0n ? 'DBIT' : 'CRDT',
		currency,
		balanceAfter: balance && formatUnits(balance.units, amountScale(balance, amount)),
		bankReference: null,
		counterpartyName: optional(layout.counterpartyName),
		counterpartyIban: counterpartyIban(optional(layout.counterpartyIban)),
		remittanceInformation: null,
		description: description || null,
		bankTransactionCode: optional(layout.bankTransactionCode),
		bankTransactionSubCode: null,
		referenceNumber: null,
	};
}

/** An amount without a thousands separator; a sign only where the layout writes one. */
function parseAmount(text: string, decimalMark: '.' | ',', signed: boolean): Decimal {
	const amount = signed || !/^[+-]/.test(text) ? parseDecimal(text, decimalMark) : null;
	if (!amount) throw new RowProblem();
	return amount;
}

function parseDate(text: string, format: CsvDateFormat): string {
	const {pattern, order} = DATE_PATTERNS[format];
	const parts = pattern.exec(text);
	const date = parts ? `${parts[order[0]]}-${parts[order[1]]}-${parts[order[2]]}` : null;
	if (!date || !isCalendarDate(date)) throw new RowProblem();
	return date;
}

/** Empty, or an old account number of digits only: none. Anything else must be a valid IBAN. */
function counterpartyIban(value: string | null): string | null {
	const compact = value?.replace(/\s+/g, '').toUpperCase();
	if (!compact || /^\d+$/.test(compact)) return null;
	const iban = normalizeIban(compact);
	if (!iban) throw new RowProblem();
	return iban;
}
