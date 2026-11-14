import {normalizeIban} from '../../banking/own-transfer/iban';
import {ABN_AMRO_BIC, abnAmroDescriptionFields, abnAmroIban} from './abn-amro';
import {checkedDate, isCalendarDate} from './dates';
import {Decimal, amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal} from './parse-result';

const TAG = /^:(\d{2}[A-Z]?):(.*)$/;
const BALANCE = /^([CD])(\d{6})([A-Z]{3})(\d{1,15},\d*)$/;
// Value date, entry date, mark (a leading R is a reversal), funds code, amount, type, code, references.
const ENTRY = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d{1,15},\d*)([A-Z])([A-Z0-9]{3})(.*)$/;
const SNIFF_BYTES = 4096;
const SNIFF_LINES = 5;
const ABN_AMRO_LINE_WIDTH = 65;
const NO_REFERENCE = 'NONREF';
const MAX_ENTRY_DATE_DISTANCE_DAYS = 180;
const DAY_MS = 86_400_000;

/** A `:20:` tag (the statement reference) within the first lines. */
export function looksLikeMt940(bytes: Uint8Array): boolean {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, SNIFF_BYTES)).toString(
		'latin1',
	);
	return head
		.split(/\r?\n/)
		.slice(0, SNIFF_LINES)
		.some((line) => line.startsWith(':20:'));
}

type Field = {tag: string; lines: string[]};
type RawStatement = {header: string[]; fields: Field[]; closed: boolean};

/**
 * Reads an MT940 file (latin-1, any number of statements) into one normalized statement per `:20:`. Entries are
 * oldest first: the balance after each is the opening balance plus the entries so far, and the last must equal
 * the closing balance. ABN AMRO's statements (headed by its BIC) get its IBAN derivation, dates and description
 * fields; other banks' get the plain reading of the tags.
 */
export function parseMt940(bytes: Uint8Array): NormalizedStatement[] {
	const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
	return splitStatements(text).map(parseStatement);
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

type Entry = {line: string; information: string[] | null};

function parseStatement(statement: RawStatement): NormalizedStatement {
	const abnAmro = statement.header.includes(ABN_AMRO_BIC);
	let account: string | null = null;
	let sequence: string | null = null;
	let opening: Balance | null = null;
	let closing: Balance | null = null;
	const entries: Entry[] = [];
	let previousTag: string | null = null;
	for (const {tag, lines} of statement.fields) {
		if (tag === '25') account = lines[0].trim();
		else if (tag === '28' || tag === '28C') sequence = /^\d+/.exec(lines[0].trim())?.[0] ?? null;
		else if (tag === '60F' || tag === '60M') opening ??= balance(lines[0]);
		else if (tag === '62F' || tag === '62M') closing = balance(lines[0]);
		else if (tag === '61') entries.push({line: lines[0], information: null});
		// Information right after an entry describes it; elsewhere it describes the statement.
		else if (tag === '86' && previousTag === '61') entries.at(-1)!.information = lines;
		previousTag = tag;
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
		accountCurrency: opening.currency,
		sequenceNumber: sequence === null ? null : BigInt(sequence).toString(),
		entriesSkipped: 0,
		rows: rows.map(({row}, index) => ({...row, balanceAfter: balances[index]})),
	};
}

/** ABN AMRO writes its bare account number; others an IBAN, optionally followed by the currency, or an own id. */
function accountOf(account: string, abnAmro: boolean): {iban: string | null; otherId: string | null} {
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
		date: shortDate(date),
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
	const valueDate = shortDate(valueDay);

	const separator = references.indexOf('//');
	const ownReference = (separator >= 0 ? references.slice(0, separator) : references).trim();
	const bankReference = separator >= 0 ? references.slice(separator + 2).trim() : '';
	const customerReference = ownReference && ownReference.toUpperCase() !== NO_REFERENCE ? ownReference : null;

	const lines = entry.information ?? [];
	const description = abnAmro
		? lines
				.map((line, index) => (index < lines.length - 1 ? line.padEnd(ABN_AMRO_LINE_WIDTH) : line))
				.join('')
				.trimEnd()
		: lines
				.map((line) => line.trim())
				.filter(Boolean)
				.join(' ');
	const fields = abnAmro && description ? abnAmroDescriptionFields(description) : null;

	const row: NormalizedRow = {
		// ABN AMRO books an entry on the statement's day; its entry date repeats the value date.
		bookingDate: abnAmro || !entryDay ? statementDate : nearestDate(entryDay, valueDate),
		valueDate,
		transactionDate: null,
		amount: formatUnits(units, amountScale(decimal)),
		creditDebitIndicator: credit ? 'CRDT' : 'DBIT',
		currency,
		balanceAfter: null,
		bankReference: bankReference || null,
		counterpartyName: fields?.counterpartyName ?? null,
		counterpartyIban: fields?.counterpartyIban ?? null,
		remittanceInformation: fields?.remittanceInformation ?? null,
		description: description || null,
		bankTransactionCode: null,
		bankTransactionSubCode: null,
		referenceNumber: fields?.referenceNumber ?? customerReference,
	};
	return {row, decimal};
}

/** `YYMMDD` as a date; years run from 1980 to 2079. */
function shortDate(value: string): string {
	const year = Number(value.slice(0, 2));
	return checkedDate(`${year < 80 ? 2000 + year : 1900 + year}-${value.slice(2, 4)}-${value.slice(4, 6)}`);
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
