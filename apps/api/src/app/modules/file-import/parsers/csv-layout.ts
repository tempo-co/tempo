/**
 * A bank's CSV export, or a table an owner's saved layout describes, as plain data, so that a layout can be stored
 * and checked like any other JSON value. Columns are 0-based positions in a row.
 */
export type CsvLayout = CsvLayoutColumns & (CsvTextTable | CsvWorkbookTable);

/** Delimited text: the default source. */
export type CsvTextTable = {
	source?: 'text';
	delimiter: CsvDelimiter;
	quote: '"' | "'";
	/**
	 * `utf-8` refuses bytes that are not UTF-8. `windows-1252` reads a file that is valid UTF-8 as UTF-8 and any
	 * other file as Windows-1252, since Windows-1252 text with letters outside ASCII is almost never valid UTF-8.
	 */
	encoding: 'utf-8' | 'windows-1252';
};

/**
 * The first sheet of a workbook. Cells are read as text, except that a number in a date column is a day serial
 * (days since 1899-12-30, any time of day ignored) and a number in an amount or balance column is that amount.
 */
export type CsvWorkbookTable = {source: 'xlsx'};

type CsvLayoutColumns = {
	/** Stable id, as stored on the import record: lower-case letters, digits and hyphens. */
	id: string;
	/** The bank's name as the owner knows it. */
	bank: string;
	/** How a file is recognised as this layout before its rows are read. */
	recognize: CsvHeaderRecognition | CsvHeaderlessRecognition;
	/** Lines (non-blank records) above the header, or above the first row of a file without one; never compared. */
	skipBefore?: number;
	/** Lines below the last row. */
	skipAfter?: number;
	decimalMark: ',' | '.';
	/**
	 * Amounts may carry this thousands separator (or none), a currency symbol or code before or after the number, and
	 * parentheses or a trailing minus for a negative amount. Without it, amounts are plain decimals.
	 */
	amountStyle?: {thousandsSeparator: CsvThousandsSeparator | null};
	/** Any of these may be followed by a time of day, which is ignored. */
	dateFormat: CsvDateFormat;
	/** The column holding the account's IBAN. */
	accountIban?: number;
	/** Which of the `skipBefore` lines (0-based) holds the account's IBAN. Without either, rows name no account. */
	accountIbanLine?: number;
	currency: {column: number} | {fixed: string};
	bookingDate: number;
	valueDate?: number;
	transactionDate?: number;
	amount: CsvAmount;
	/** The account's balance next to each row: after the row, or before it. */
	balance?: {column: number; when: 'after' | 'before'};
	counterpartyName?: number;
	/** An old account number (digits only) is left out; any other value must be a valid IBAN. */
	counterpartyIban?: number;
	/** Joined with spaces, empty values left out. */
	description: number[];
	bankTransactionCode?: number;
};

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];
export const CSV_THOUSANDS_SEPARATORS = ['.', ',', ' ', "'"] as const;
export type CsvThousandsSeparator = (typeof CSV_THOUSANDS_SEPARATORS)[number];

export type CsvHeaderRecognition = {
	/** The rows above the header, compared like the header. */
	preamble?: string[][];
	/** Compared cell by cell after trimming, case-folding and removing a byte order mark. */
	header: string[];
};

/**
 * A file without a header is claimed only when every row reads. With `accountBankCodes`, every row's account IBAN
 * must also be held at one of these banks (the four letters after the check digits), so another bank's export of
 * the same shape is not. Without them (an owner's saved layout, tried last and for that owner only), the layout
 * must check a third column besides the date and the amount: the account, a currency, a balance or a second date.
 */
export type CsvHeaderlessRecognition = {columnCount: number; accountBankCodes?: string[]};

export const CSV_DATE_FORMATS = [
	'YYYY-MM-DD',
	'YYYYMMDD',
	'DD-MM-YYYY',
	'DD/MM/YYYY',
	'MM/DD/YYYY',
	'DD.MM.YYYY',
	'YYYY/MM/DD',
	'DD-MM-YY',
	'DD/MM/YY',
	'MM/DD/YY',
	'DD.MM.YY',
] as const;
export type CsvDateFormat = (typeof CSV_DATE_FORMATS)[number];

export type CsvAmount =
	/** One column with a signed amount. */
	| {kind: 'signed'; column: number}
	/** An unsigned amount and a column whose value says which way it went. */
	| {kind: 'direction'; column: number; directionColumn: number; debit: string; credit: string}
	/** Money out and money in in two columns, exactly one of them filled in each row. */
	| {kind: 'debitCredit'; debitColumn: number; creditColumn: number};

export type CsvLayoutValidation = {ok: true; layout: CsvLayout} | {ok: false; error: string};

const LAYOUT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LAYOUT_ID_LENGTH = 64;
const CURRENCY = /^[A-Z]{3}$/;
const BANK_CODE = /^[A-Z0-9]{4}$/;
export const MAX_LAYOUT_COLUMNS = 200;
const MAX_TEXT = 200;
export const MAX_SKIP_BEFORE = 50;
export const MAX_SKIP_AFTER = 10;

/** Whether a value has the shape of a layout id. */
export function isCsvLayoutId(value: unknown): value is string {
	return typeof value === 'string' && value.length <= MAX_LAYOUT_ID_LENGTH && LAYOUT_ID.test(value);
}

/** The number of columns a layout's rows have. */
export function csvLayoutColumnCount({recognize}: Pick<CsvLayout, 'recognize'>): number {
	return 'header' in recognize ? recognize.header.length : recognize.columnCount;
}

/** Thrown inside the validator only; `validateCsvLayout` turns it into its result. */
class LayoutProblem {
	constructor(readonly message: string) {}
}

/**
 * Checks that a value is a complete layout: every required field present, no unknown field, every column within the
 * row and every count within its limit. Returns a copy holding only the layout's fields.
 */
export function validateCsvLayout(value: unknown): CsvLayoutValidation {
	try {
		return {ok: true, layout: layoutOf(value)};
	} catch (error) {
		if (error instanceof LayoutProblem) return {ok: false, error: error.message};
		throw error;
	}
}

function layoutOf(value: unknown): CsvLayout {
	const workbook = isRecord(value) && value.source === 'xlsx';
	const layout = record(value, 'layout', {
		required: [
			'id',
			'bank',
			'recognize',
			...(workbook ? [] : ['delimiter', 'quote', 'encoding']),
			'decimalMark',
			'dateFormat',
			'currency',
			'bookingDate',
			'amount',
			'description',
		],
		optional: [
			'source',
			'skipBefore',
			'skipAfter',
			'amountStyle',
			'accountIban',
			'accountIbanLine',
			'valueDate',
			'transactionDate',
			'balance',
			'counterpartyName',
			'counterpartyIban',
			'bankTransactionCode',
		],
	});
	const id = text(layout.id, 'id');
	if (!isCsvLayoutId(id)) throw new LayoutProblem('id');
	const recognize = recognitionOf(layout.recognize);
	const columns = csvLayoutColumnCount({recognize});
	const column = (value: unknown, name: string) => {
		if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= columns) {
			throw new LayoutProblem(name);
		}
		return value as number;
	};
	const optionalColumn = (value: unknown, name: string) => (value === undefined ? undefined : column(value, name));
	const skipBefore = count(layout.skipBefore, MAX_SKIP_BEFORE, 'skipBefore');
	// A preamble is compared, skipped lines are not: a layout has one or the other.
	if ('preamble' in recognize && skipBefore !== undefined) throw new LayoutProblem('skipBefore');
	const skipAfter = count(layout.skipAfter, MAX_SKIP_AFTER, 'skipAfter');

	const currencyValue = record(layout.currency, 'currency', {required: [], optional: ['column', 'fixed']});
	const currency =
		'column' in currencyValue && !('fixed' in currencyValue)
			? {column: column(currencyValue.column, 'currency.column')}
			: 'fixed' in currencyValue &&
				  !('column' in currencyValue) &&
				  typeof currencyValue.fixed === 'string' &&
				  CURRENCY.test(currencyValue.fixed)
				? {fixed: currencyValue.fixed as string}
				: null;
	if (!currency) throw new LayoutProblem('currency');

	const balanceValue =
		layout.balance === undefined
			? undefined
			: record(layout.balance, 'balance', {required: ['column', 'when'], optional: []});
	if (!Array.isArray(layout.description) || layout.description.length > columns) {
		throw new LayoutProblem('description');
	}
	const decimalMark = oneOf(layout.decimalMark, ['.', ','] as const, 'decimalMark');
	const amountStyleValue =
		layout.amountStyle === undefined
			? undefined
			: record(layout.amountStyle, 'amountStyle', {required: [], optional: ['thousandsSeparator']});
	if (amountStyleValue && !('thousandsSeparator' in amountStyleValue)) {
		throw new LayoutProblem('amountStyle: missing thousandsSeparator');
	}
	const thousandsSeparator =
		amountStyleValue && amountStyleValue.thousandsSeparator !== null
			? oneOf(amountStyleValue.thousandsSeparator, CSV_THOUSANDS_SEPARATORS, 'amountStyle.thousandsSeparator')
			: null;
	if (thousandsSeparator === decimalMark) throw new LayoutProblem('amountStyle.thousandsSeparator');

	const accountIban = optionalColumn(layout.accountIban, 'accountIban');
	const accountIbanLine = count(layout.accountIbanLine, MAX_SKIP_BEFORE - 1, 'accountIbanLine');
	if (accountIbanLine !== undefined && (accountIban !== undefined || accountIbanLine >= (skipBefore ?? 0))) {
		throw new LayoutProblem('accountIbanLine');
	}
	const valueDate = optionalColumn(layout.valueDate, 'valueDate');
	const transactionDate = optionalColumn(layout.transactionDate, 'transactionDate');
	const validated: CsvLayout = {
		id,
		bank: text(layout.bank, 'bank'),
		recognize,
		...(workbook
			? {source: 'xlsx' as const}
			: {
					...(layout.source === undefined ? {} : {source: oneOf(layout.source, ['text'] as const, 'source')}),
					delimiter: oneOf(layout.delimiter, CSV_DELIMITERS, 'delimiter'),
					quote: oneOf(layout.quote, ['"', "'"] as const, 'quote'),
					encoding: oneOf(layout.encoding, ['utf-8', 'windows-1252'] as const, 'encoding'),
				}),
		...defined('skipBefore', skipBefore),
		...defined('skipAfter', skipAfter),
		decimalMark,
		...(amountStyleValue ? {amountStyle: {thousandsSeparator}} : {}),
		dateFormat: oneOf(layout.dateFormat, CSV_DATE_FORMATS, 'dateFormat'),
		...defined('accountIban', accountIban),
		...defined('accountIbanLine', accountIbanLine),
		currency,
		bookingDate: column(layout.bookingDate, 'bookingDate'),
		...defined('valueDate', valueDate),
		...defined('transactionDate', transactionDate),
		amount: amountOf(layout.amount, column),
		...(balanceValue === undefined
			? {}
			: {
					balance: {
						column: column(balanceValue.column, 'balance.column'),
						when: oneOf(balanceValue.when, ['after', 'before'] as const, 'balance.when'),
					},
				}),
		...defined('counterpartyName', optionalColumn(layout.counterpartyName, 'counterpartyName')),
		...defined('counterpartyIban', optionalColumn(layout.counterpartyIban, 'counterpartyIban')),
		description: layout.description.map((value: unknown) => column(value, 'description')),
		...defined('bankTransactionCode', optionalColumn(layout.bankTransactionCode, 'bankTransactionCode')),
	};
	if ('columnCount' in recognize && !checksAThirdColumn(validated, recognize)) {
		throw new LayoutProblem('recognize.columnCount');
	}
	return validated;
}

/**
 * A layout without a header is recognised by its rows alone: bank codes checked on its account column, or a column
 * other than its date and amounts that every row must pass (an IBAN, a currency, a balance or a second date).
 */
function checksAThirdColumn(layout: CsvLayout, recognize: {accountBankCodes?: readonly string[]}): boolean {
	if (recognize.accountBankCodes) return layout.accountIban !== undefined;
	const {amount} = layout;
	const taken = new Set([
		layout.bookingDate,
		...(amount.kind === 'debitCredit'
			? [amount.debitColumn, amount.creditColumn]
			: amount.kind === 'direction'
				? [amount.column, amount.directionColumn]
				: [amount.column]),
	]);
	return [
		layout.accountIban,
		'column' in layout.currency ? layout.currency.column : undefined,
		layout.balance?.column,
		layout.valueDate,
		layout.transactionDate,
	].some((column) => column !== undefined && !taken.has(column));
}

function recognitionOf(value: unknown): CsvLayout['recognize'] {
	const recognize = record(value, 'recognize', {
		required: [],
		optional: ['preamble', 'header', 'columnCount', 'accountBankCodes'],
	});
	if ('header' in recognize) {
		if ('columnCount' in recognize || 'accountBankCodes' in recognize) throw new LayoutProblem('recognize');
		const header = cells(recognize.header, 'recognize.header');
		if (header.length === 0 || header.length > MAX_LAYOUT_COLUMNS) throw new LayoutProblem('recognize.header');
		if (recognize.preamble === undefined) return {header};
		if (!Array.isArray(recognize.preamble) || recognize.preamble.length > MAX_SKIP_BEFORE) {
			throw new LayoutProblem('recognize.preamble');
		}
		return {preamble: recognize.preamble.map((row) => cells(row, 'recognize.preamble')), header};
	}
	if ('preamble' in recognize) throw new LayoutProblem('recognize.preamble');
	const {columnCount, accountBankCodes} = recognize;
	if (!Number.isInteger(columnCount) || (columnCount as number) < 1 || (columnCount as number) > MAX_LAYOUT_COLUMNS) {
		throw new LayoutProblem('recognize.columnCount');
	}
	if (accountBankCodes === undefined) return {columnCount: columnCount as number};
	if (
		!Array.isArray(accountBankCodes) ||
		accountBankCodes.length === 0 ||
		!accountBankCodes.every((code) => typeof code === 'string' && BANK_CODE.test(code))
	) {
		throw new LayoutProblem('recognize.accountBankCodes');
	}
	return {columnCount: columnCount as number, accountBankCodes: [...(accountBankCodes as string[])]};
}

function amountOf(value: unknown, column: (value: unknown, name: string) => number): CsvAmount {
	const kind = record(value, 'amount', {required: ['kind'], optional: []}, true).kind;
	if (kind === 'signed') {
		const amount = record(value, 'amount', {required: ['kind', 'column'], optional: []});
		return {kind, column: column(amount.column, 'amount.column')};
	}
	if (kind === 'direction') {
		const amount = record(value, 'amount', {
			required: ['kind', 'column', 'directionColumn', 'debit', 'credit'],
			optional: [],
		});
		const debit = text(amount.debit, 'amount.debit');
		const credit = text(amount.credit, 'amount.credit');
		if (debit === credit) throw new LayoutProblem('amount.credit');
		const amountColumn = column(amount.column, 'amount.column');
		const directionColumn = column(amount.directionColumn, 'amount.directionColumn');
		if (directionColumn === amountColumn) throw new LayoutProblem('amount.directionColumn');
		return {kind, column: amountColumn, directionColumn, debit, credit};
	}
	if (kind === 'debitCredit') {
		const amount = record(value, 'amount', {required: ['kind', 'debitColumn', 'creditColumn'], optional: []});
		const debitColumn = column(amount.debitColumn, 'amount.debitColumn');
		const creditColumn = column(amount.creditColumn, 'amount.creditColumn');
		if (debitColumn === creditColumn) throw new LayoutProblem('amount.creditColumn');
		return {kind, debitColumn, creditColumn};
	}
	throw new LayoutProblem('amount.kind');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** An object with every required key, and no key outside the two lists unless `open`. */
function record(
	value: unknown,
	name: string,
	{required, optional}: {required: string[]; optional: string[]},
	open = false,
): Record<string, unknown> {
	if (!isRecord(value)) throw new LayoutProblem(name);
	for (const key of required) if (value[key] === undefined) throw new LayoutProblem(`${name}: missing ${key}`);
	if (!open) {
		for (const key of Object.keys(value)) {
			if (!required.includes(key) && !optional.includes(key)) throw new LayoutProblem(`${name}: unknown ${key}`);
		}
	}
	return value;
}

function text(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_TEXT) throw new LayoutProblem(name);
	return value;
}

/** A whole number from 0 to `max`; undefined when absent. */
function count(value: unknown, max: number, name: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max) throw new LayoutProblem(name);
	return value as number;
}

function cells(value: unknown, name: string): string[] {
	if (!Array.isArray(value) || !value.every((cell) => typeof cell === 'string' && cell.length <= MAX_TEXT)) {
		throw new LayoutProblem(name);
	}
	return [...(value as string[])];
}

function oneOf<T extends string>(value: unknown, values: readonly T[], name: string): T {
	if (!(values as readonly unknown[]).includes(value)) throw new LayoutProblem(name);
	return value as T;
}

function defined<K extends string>(key: K, value: number | undefined): {[key in K]?: number} {
	return value === undefined ? {} : ({[key]: value} as {[key in K]: number});
}
