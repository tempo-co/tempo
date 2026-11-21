import {normalizeIban} from '../../banking/own-transfer/iban';
import {ABN_AMRO_BIC, abnAmroDescriptionFields, abnAmroIban} from './abn-amro';
import {isCalendarDate} from './dates';
import {Decimal, amountScale, formatUnits, parseDecimal} from './decimal';
import {InformationFields, informationFields} from './mt940-information';
import {BIC, NormalizedRow, NormalizedStatement, ParseRefusal} from './parse-result';

const TAG = /^:(\d{2}[A-Z]?):(.*)$/;
const BALANCE = /^([CD])(\d{6})([A-Z]{3})(\d{1,15},\d*)$/;
/**
 * Value date, entry date (or spaces in its place), mark (a leading R is a reversal), funds code, amount, type and
 * code (some banks put a space before the type, or pad a two-letter code with one), references.
 */
const ENTRY = /^(\d{6})(\d{4}| {4})?(RC|RD|C|D)([A-Z])?(\d{1,15},\d*) ?([A-Z])([A-Z0-9]{3}|[A-Z0-9]{2} )(.*)$/;
const SNIFF_BYTES = 4096;
const SNIFF_LINES = 5;
const ABN_AMRO_LINE_WIDTH = 65;
const NO_REFERENCE = 'NONREF';
const MAX_ENTRY_DATE_DISTANCE_DAYS = 180;
const DAY_MS = 86_400_000;
/** The first account's IBAN country, which tells the encoding of a file that is not UTF-8. */
const ACCOUNT_COUNTRY = /^:25:\/?([A-Z]{2})\d{2}/m;
/** The SWIFT basic header's logical terminal address: the BIC's first eight characters, a terminal and the branch. */
const BASIC_HEADER = /\{1:F\d{2}([A-Z]{6}[A-Z0-9]{2})[A-Z0-9][A-Z0-9]{3}/;
/** An output message's application header: type, input time and date, then the sender's terminal address. */
const OUTPUT_HEADER = /\{2:O\d{3}\d{4}\d{6}([A-Z]{6}[A-Z0-9]{2})/;
/** Countries whose banks write Windows-1250 or ISO-8859-2 (Ł, Ś, Ž, Ő): Central Europe and Romania. */
const CENTRAL_EUROPEAN_COUNTRIES = new Set(['PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'RO']);

/** A `:20:` tag (the statement reference) within the first lines that are not blank. */
export function looksLikeMt940(bytes: Uint8Array): boolean {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, SNIFF_BYTES))
		.toString('latin1')
		.replace(/^\u00ef\u00bb\u00bf/, '');
	return head
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.slice(0, SNIFF_LINES)
		.some((line) => line.startsWith(':20:'));
}

type Field = {tag: string; lines: string[]};
type RawStatement = {header: string[]; fields: Field[]; closed: boolean};

/**
 * Reads an MT940 file (any number of statements, in the encoding `decode` finds) into one normalized
 * statement per `:20:`. Entries are oldest first: the balance after each is the opening balance plus the entries so
 * far, and the last must equal the closing balance. ABN AMRO's statements (headed by its BIC) get its IBAN
 * derivation, dates and description fields; other banks' get the payee and text of the published `:86:` layouts
 * (`informationFields`).
 */
export function parseMt940(bytes: Uint8Array): NormalizedStatement[] {
	return splitStatements(decode(bytes)).map(parseStatement);
}

/**
 * UTF-8 when the file decodes as such. Otherwise, for an account in a Central European country, Windows-1250 or
 * ISO-8859-2, whichever reads more of the non-ASCII bytes as letters (Windows-1250 on a tie); for any other account,
 * Windows-1252, of which latin-1 is a part.
 */
function decode(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
	} catch {
		const country = ACCOUNT_COUNTRY.exec(
			Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1'),
		);
		if (!country || !CENTRAL_EUROPEAN_COUNTRIES.has(country[1]))
			return new TextDecoder('windows-1252').decode(bytes);
		const [windows, iso] = ['windows-1250', 'iso-8859-2'].map((label) => new TextDecoder(label).decode(bytes));
		return letters(iso) > letters(windows) ? iso : windows;
	}
}

function letters(text: string): number {
	return text.match(/[^\x00-\x7f]/gu)?.filter((character) => /\p{L}/u.test(character)).length ?? 0;
}

function splitStatements(text: string): RawStatement[] {
	const statements: RawStatement[] = [];
	let header: string[] = [];
	let current: RawStatement | null = null;
	for (const line of text.split(/\r?\n/)) {
		const tag = TAG.exec(line);
		if (tag?.[1] === '20') {
			current = {header, fields: [], closed: false};
			statements.push(current);
			header = [];
		}
		if (tag) {
			if (!current) throw new ParseRefusal('parse_failed');
			current.fields.push({tag: tag[1], lines: [tag[2]]});
			if (/^62[FM]$/.test(tag[1])) current.closed = true;
		} else if (current?.closed && line.trim() === '-') {
			current = null;
		} else if (current) {
			// A field continues on the lines up to the next tag.
			current.fields.at(-1)!.lines.push(line);
		} else if (line.trim()) {
			header.push(line.trim());
		}
	}
	return statements;
}

/** The `:61:` line, its supplementary details line if any, and the lines of each `:86:` field after it. */
type Entry = {line: string; details: string | null; information: string[][]};

function parseStatement(statement: RawStatement): NormalizedStatement {
	const abnAmro = statement.header.includes(ABN_AMRO_BIC);
	let account: string | null = null;
	let sequence: string | null = null;
	let opening: Balance | null = null;
	let closing: Balance | null = null;
	const entries: Entry[] = [];
	// Whether the field before describes an entry: the entry itself, or information about it.
	let afterEntry = false;
	for (const {tag, lines} of statement.fields) {
		if (tag === '25') account = lines[0].trim();
		else if (tag === '28' || tag === '28C') sequence = /^\d+/.exec(lines[0].trim())?.[0] ?? null;
		else if (tag === '60F' || tag === '60M') opening ??= balance(lines[0]);
		else if (tag === '62F' || tag === '62M') closing = balance(lines[0]);
		// The closing available balance: read only to refuse a file cut inside it.
		else if (tag === '64') balance(lines[0]);
		else if (tag === '61') entries.push({line: lines[0], details: lines[1]?.trim() || null, information: []});
		// Information right after an entry describes it (some banks write two fields); elsewhere the statement.
		else if (tag === '86' && afterEntry) entries.at(-1)!.information.push(lines);
		afterEntry = tag === '61' || (tag === '86' && afterEntry);
	}
	if (!account || !opening || !closing || opening.currency !== closing.currency) {
		throw new ParseRefusal('parse_failed');
	}

	const rows = entries.map((entry) => parseEntry(entry, opening.currency, closing.date, abnAmro));
	const scale = amountScale(opening.amount, closing.amount, ...rows.map(({decimal}) => decimal));
	let running = opening.amount.units;
	const balances = rows.map(({decimal}) => {
		running += decimal.units;
		return formatUnits(running, scale);
	});
	if (running !== closing.amount.units) throw new ParseRefusal('parse_failed');

	const {iban, otherId} = accountOf(account, abnAmro);
	return {
		format: 'mt940',
		layout: null,
		accountIban: iban,
		accountOtherId: otherId,
		bank: null,
		servicerBic: headerBic(statement.header),
		accountCurrency: opening.currency,
		sequenceNumber: sequence === null ? null : BigInt(sequence).toString(),
		entriesSkipped: 0,
		openingBalance: {date: opening.date, amount: formatUnits(opening.amount.units, scale)},
		closingBalance: {date: closing.date, amount: formatUnits(closing.amount.units, scale)},
		rows: rows.map(({row}, index) => ({...row, balanceAfter: balances[index]})),
	};
}

/**
 * The sending bank's BIC from the lines above the statement: the sender of a SWIFT output message, else the basic
 * header's address, else a header of the BIC over the message type (`940`), as ABN AMRO writes it. Null for any other
 * header: a bank's name can look like a BIC.
 */
function headerBic(header: readonly string[]): string | null {
	const text = header.join('');
	const swift = OUTPUT_HEADER.exec(text)?.[1] ?? BASIC_HEADER.exec(text)?.[1];
	if (swift) return swift;
	const typeLine = header.indexOf('940');
	return typeLine > 0 && BIC.test(header[typeLine - 1]) ? header[typeLine - 1] : null;
}

/**
 * ABN AMRO writes its bare account number; others an IBAN (some after a slash), optionally followed by the currency,
 * or an own id.
 */
function accountOf(written: string, abnAmro: boolean): {iban: string | null; otherId: string | null} {
	const account = written.replace(/^\/(?=[A-Z]{2}\d{2})/, '');
	if (abnAmro && /^\d+$/.test(account)) {
		const iban = abnAmroIban(account);
		if (!iban) throw new ParseRefusal('parse_failed');
		return {iban, otherId: null};
	}
	const iban = normalizeIban(account) ?? (/[A-Z]{3}$/i.test(account) ? normalizeIban(account.slice(0, -3)) : null);
	return iban ? {iban, otherId: null} : {iban: null, otherId: account};
}

type Balance = {date: string; currency: string; amount: Decimal};

function balance(value: string): Balance {
	const [, mark, date, currency, amount] = BALANCE.exec(value.trim()) ?? [];
	const decimal = amount === undefined ? null : parseDecimal(amount, ',');
	if (!decimal) throw new ParseRefusal('parse_failed');
	return {
		date: dateOf(date),
		currency,
		amount: {units: mark === 'D' ? -decimal.units : decimal.units, scale: decimal.scale},
	};
}

function parseEntry(
	entry: Entry,
	currency: string,
	statementDate: string,
	abnAmro: boolean,
): {row: NormalizedRow; decimal: Decimal} {
	const [, valueDay, entryDay, mark, , amountText, , , references] = ENTRY.exec(entry.line.trim()) ?? [];
	const unsigned = amountText === undefined ? null : parseDecimal(amountText, ',');
	if (!unsigned) throw new ParseRefusal('parse_failed');
	// A reversal (RC, RD) undoes an entry of the named direction, so the money moves the other way.
	const credit = mark.endsWith('C') !== mark.startsWith('R');
	const units = credit ? unsigned.units : -unsigned.units;
	const decimal = {units, scale: unsigned.scale};
	const valueDate = dateOf(valueDay);

	const separator = references.indexOf('//');
	const ownReference = (separator >= 0 ? references.slice(0, separator) : references).trim();
	const bankReference = separator >= 0 ? references.slice(separator + 2).trim() : '';
	const customerReference = ownReference && ownReference.toUpperCase() !== NO_REFERENCE ? ownReference : null;

	let description: string | null;
	let fields: InformationFields | null = null;
	if (abnAmro) {
		const lines = entry.information.flat();
		description =
			lines
				.map((line, index) => (index < lines.length - 1 ? line.padEnd(ABN_AMRO_LINE_WIDTH) : line))
				.join('')
				.trimEnd() || null;
		fields = description ? {...abnAmroDescriptionFields(description), description} : null;
	} else {
		fields = joinFields(entry.information.map((lines) => informationFields(lines, credit)));
		description = fields?.description ?? null;
	}
	// The supplementary details of the entry line hold the counterparty's account at some banks.
	const detailsIban = abnAmro ? null : normalizeIban(entry.details);

	const row: NormalizedRow = {
		// ABN AMRO books an entry on the statement's day; its entry date repeats the value date. Elsewhere an entry
		// without an entry date is booked on its value date.
		bookingDate: abnAmro ? statementDate : entryDay?.trim() ? nearestDate(entryDay, valueDate) : valueDate,
		valueDate,
		transactionDate: null,
		amount: formatUnits(units, amountScale(decimal)),
		creditDebitIndicator: credit ? 'CRDT' : 'DBIT',
		currency,
		balanceAfter: null,
		bankReference: bankReference || null,
		counterpartyName: fields?.counterpartyName ?? null,
		counterpartyIban: fields?.counterpartyIban ?? detailsIban,
		remittanceInformation: fields?.remittanceInformation ?? null,
		description,
		bankTransactionCode: null,
		bankTransactionSubCode: null,
		referenceNumber: fields?.referenceNumber ?? customerReference,
	};
	return {row, decimal};
}

/** The information of several `:86:` fields: each detail from the first that has it, the descriptions joined. */
function joinFields(fields: InformationFields[]): InformationFields | null {
	if (fields.length === 0) return null;
	const first = <K extends keyof InformationFields>(key: K) => fields.find((field) => field[key])?.[key] ?? null;
	return {
		counterpartyName: first('counterpartyName'),
		counterpartyIban: first('counterpartyIban'),
		remittanceInformation: first('remittanceInformation'),
		referenceNumber: first('referenceNumber'),
		description:
			fields
				.map(({description}) => description)
				.filter(Boolean)
				.join(' ') || null,
	};
}

function shortDateText(value: string): string {
	const year = Number(value.slice(0, 2));
	return `${year < 80 ? 2000 + year : 1900 + year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
}

/**
 * `YYMMDD` as a date; years run from 1980 to 2079. Interest and fee entries counted in 30-day months (30/360), and
 * the balances after them, can be dated 29 to 31 of a month that is shorter, such as 30 February: that is the month's
 * last day.
 */
function dateOf(value: string): string {
	const date = shortDateText(value);
	if (isCalendarDate(date)) return date;
	const [year, month, day] = date.split('-').map(Number);
	if (month < 1 || month > 12 || day < 29 || day > 31) throw new ParseRefusal('parse_failed');
	return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** `MMDD` in the year that puts it within 180 days of the value date. */
function nearestDate(monthDay: string, valueDate: string): string {
	const valueYear = Number(valueDate.slice(0, 4));
	for (const year of [valueYear, valueYear - 1, valueYear + 1]) {
		const date = `${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2, 4)}`;
		if (!isCalendarDate(date)) continue;
		const distance = Math.abs(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${valueDate}T00:00:00Z`)) / DAY_MS;
		if (distance <= MAX_ENTRY_DATE_DISTANCE_DAYS) return date;
	}
	throw new ParseRefusal('parse_failed');
}
