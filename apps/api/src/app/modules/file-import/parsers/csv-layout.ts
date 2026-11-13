/**
 * A bank's CSV export described as plain data, so that a layout can be stored and checked like any other JSON
 * value. Columns are 0-based positions in a row.
 */
export type CsvLayout = {
	/** Stable id, as stored on the import record: lower-case letters, digits and hyphens. */
	id: string;
	/** The bank's name as the owner knows it. */
	bank: string;
	/** How a file is recognised as this layout before its rows are read. */
	recognize: CsvHeaderRecognition | CsvHeaderlessRecognition;
	delimiter: ',' | ';';
	quote: '"' | "'";
	/**
	 * `utf-8` refuses bytes that are not UTF-8. `windows-1252` reads a file that is valid UTF-8 as UTF-8 and any
	 * other file as Windows-1252, since Windows-1252 text with letters outside ASCII is almost never valid UTF-8.
	 */
	encoding: 'utf-8' | 'windows-1252';
	/** Amounts are written without a thousands separator. */
	decimalMark: ',' | '.';
	dateFormat: CsvDateFormat;
	accountIban: number;
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

export type CsvHeaderRecognition = {
	/** The rows above the header, compared like the header. */
	preamble?: string[][];
	/** Compared cell by cell after trimming, case-folding and removing a byte order mark. */
	header: string[];
};

/**
 * A file without a header is claimed only when every row reads, and every row's account IBAN is valid and held at
 * one of these banks (the four letters after the check digits), so another bank's export of the same shape is not.
 */
export type CsvHeaderlessRecognition = {columnCount: number; accountBankCodes: string[]};

export const CSV_DATE_FORMATS = ['YYYY-MM-DD', 'YYYYMMDD', 'DD-MM-YYYY'] as const;
export type CsvDateFormat = (typeof CSV_DATE_FORMATS)[number];

export type CsvAmount =
	/** One column with a signed amount. */
	| {kind: 'signed'; column: number}
	/** An unsigned amount and a column whose value says which way it went. */
	| {kind: 'direction'; column: number; directionColumn: number; debit: string; credit: string};

export type CsvLayoutValidation = {ok: true; layout: CsvLayout} | {ok: false; error: string};

const LAYOUT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LAYOUT_ID_LENGTH = 64;
const CURRENCY = /^[A-Z]{3}$/;
const BANK_CODE = /^[A-Z0-9]{4}$/;
const MAX_COLUMNS = 200;
const MAX_TEXT = 200;

/** Whether a value has the shape of a layout id. */
export function isCsvLayoutId(value: unknown): value is string {
	return typeof value === 'string' && value.length <= MAX_LAYOUT_ID_LENGTH && LAYOUT_ID.test(value);
}

/** Thrown inside the validator only; `validateCsvLayout` turns it into its result. */
class LayoutProblem {
	constructor(readonly message: string) {}
}

/**
 * Checks that a value is a complete layout: every required field present, no unknown field, every column within the
 * row. Returns a copy holding only the layout's fields.
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
	const layout = record(value, 'layout', {
		required: [
			'id',
			'bank',
			'recognize',
			'delimiter',
			'quote',
			'encoding',
			'decimalMark',
			'dateFormat',
			'accountIban',
			'currency',
			'bookingDate',
			'amount',
			'description',
		],
		optional: [
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
	const columns = 'header' in recognize ? recognize.header.length : recognize.columnCount;
	const column = (value: unknown, name: string) => {
		if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= columns) {
			throw new LayoutProblem(name);
		}
		return value as number;
	};
	const optionalColumn = (value: unknown, name: string) => (value === undefined ? undefined : column(value, name));

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
	if (!Array.isArray(layout.description)) throw new LayoutProblem('description');

	return {
		id,
		bank: text(layout.bank, 'bank'),
		recognize,
		delimiter: oneOf(layout.delimiter, [',', ';'] as const, 'delimiter'),
		quote: oneOf(layout.quote, ['"', "'"] as const, 'quote'),
		encoding: oneOf(layout.encoding, ['utf-8', 'windows-1252'] as const, 'encoding'),
		decimalMark: oneOf(layout.decimalMark, ['.', ','] as const, 'decimalMark'),
		dateFormat: oneOf(layout.dateFormat, CSV_DATE_FORMATS, 'dateFormat'),
		accountIban: column(layout.accountIban, 'accountIban'),
		currency,
		bookingDate: column(layout.bookingDate, 'bookingDate'),
		...defined('valueDate', optionalColumn(layout.valueDate, 'valueDate')),
		...defined('transactionDate', optionalColumn(layout.transactionDate, 'transactionDate')),
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
}

function recognitionOf(value: unknown): CsvLayout['recognize'] {
	const recognize = record(value, 'recognize', {
		required: [],
		optional: ['preamble', 'header', 'columnCount', 'accountBankCodes'],
	});
	if ('header' in recognize) {
		if ('columnCount' in recognize || 'accountBankCodes' in recognize) throw new LayoutProblem('recognize');
		const header = cells(recognize.header, 'recognize.header');
		if (header.length === 0 || header.length > MAX_COLUMNS) throw new LayoutProblem('recognize.header');
		if (recognize.preamble === undefined) return {header};
		if (!Array.isArray(recognize.preamble)) throw new LayoutProblem('recognize.preamble');
		return {preamble: recognize.preamble.map((row) => cells(row, 'recognize.preamble')), header};
	}
	if ('preamble' in recognize) throw new LayoutProblem('recognize.preamble');
	const {columnCount, accountBankCodes} = recognize;
	if (!Number.isInteger(columnCount) || (columnCount as number) < 1 || (columnCount as number) > MAX_COLUMNS) {
		throw new LayoutProblem('recognize.columnCount');
	}
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
		return {
			kind,
			column: column(amount.column, 'amount.column'),
			directionColumn: column(amount.directionColumn, 'amount.directionColumn'),
			debit,
			credit,
		};
	}
	throw new LayoutProblem('amount.kind');
}

/** An object with every required key, and no key outside the two lists unless `open`. */
function record(
	value: unknown,
	name: string,
	{required, optional}: {required: string[]; optional: string[]},
	open = false,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LayoutProblem(name);
	const object = value as Record<string, unknown>;
	for (const key of required) if (object[key] === undefined) throw new LayoutProblem(`${name}: missing ${key}`);
	if (!open) {
		for (const key of Object.keys(object)) {
			if (!required.includes(key) && !optional.includes(key)) throw new LayoutProblem(`${name}: unknown ${key}`);
		}
	}
	return object;
}

function text(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_TEXT) throw new LayoutProblem(name);
	return value;
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
