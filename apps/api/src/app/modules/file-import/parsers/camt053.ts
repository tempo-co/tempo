import {type Element} from '@xmldom/xmldom';

import {checkedDate} from './dates';
import {amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal, StatementBalance, institutionBic} from './parse-result';
import {child, children, parseXml} from './xml';

/** Statements (camt.053) and account reports (camt.052), any version. */
const CAMT_NAMESPACE = /^urn:iso:std:iso:20022:tech:xsd:camt\.05([23])\.001\.\d+$/;
const CAMT_NAMESPACE_PREFIXES = [
	'urn:iso:std:iso:20022:tech:xsd:camt.053.001.',
	'urn:iso:std:iso:20022:tech:xsd:camt.052.001.',
];
/** Each kind's message element and the element of one statement or report in it. */
const CAMT_MESSAGES = {
	'3': {message: 'BkToCstmrStmt', statement: 'Stmt'},
	'2': {message: 'BkToCstmrAcctRpt', statement: 'Rpt'},
} as const;
const SNIFF_BYTES = 4096;
/** An `xs:decimal` amount, which may leave out the zero before the point (`.21`). */
const DECIMAL = /^(?:\d{1,15}(?:\.\d{1,8})?|\.\d{1,8})$/;
/** The time zone an `xs:date` may end with. */
const DATE_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;
const CURRENCY = /^[A-Z]{3}$/;
const ENCODING_DECLARATION = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/;
const OPENING_BALANCE_TYPES = ['PRCD', 'OPBD'];
const CLOSING_BALANCE_TYPE = 'CLBD';
const NOT_PROVIDED = 'NOTPROVIDED';

/**
 * A quick look at the first bytes: markup that names the CAMT.053 or camt.052 namespace. `parseCamt053` still
 * checks that the root is `Document` in that namespace, so camt.054 and other XML stay unsupported.
 */
export function looksLikeCamt053(bytes: Uint8Array): boolean {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, SNIFF_BYTES))
		.toString('latin1')
		.replace(/^\u00ef\u00bb\u00bf/, '');
	return head.trimStart().startsWith('<') && CAMT_NAMESPACE_PREFIXES.some((prefix) => head.includes(prefix));
}

/**
 * Reads a bank-to-customer statement (CAMT.053, any `camt.053.001.*` version) into one normalized statement per
 * `Stmt`, and an account report (camt.052) the same way per `Rpt`: a report has the same shape, and only its booked
 * entries are read, as for a statement. Its balances follow the statement's rules, which use only the opening and
 * closing booked balances (`PRCD`/`OPBD`, `CLBD`), never an interim one (`ITBD`), since more can be booked that day.
 * Documents declaring a DTD or entities are refused (see `parseXml`).
 */
export function parseCamt053(bytes: Uint8Array): NormalizedStatement[] {
	const root = parseXml(decode(bytes));
	const kind = CAMT_NAMESPACE.exec(root?.namespaceURI ?? '')?.[1] as keyof typeof CAMT_MESSAGES | undefined;
	if (!root || root.localName !== 'Document' || !kind) throw new ParseRefusal('unsupported_format');

	const {message, statement} = CAMT_MESSAGES[kind];
	const report = child(root, message);
	if (!report) throw new ParseRefusal('parse_failed');
	return children(report, statement).map(parseStatement);
}

function decode(bytes: Uint8Array): string {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 256)).toString('latin1');
	const label = head.replace(/^\u00ef\u00bb\u00bf/, '').match(ENCODING_DECLARATION)?.[1] ?? 'utf-8';
	try {
		return new TextDecoder(label, {fatal: true}).decode(bytes);
	} catch {
		throw new ParseRefusal('parse_failed');
	}
}

function parseStatement(statement: Element): NormalizedStatement {
	const account = child(statement, 'Acct');
	const accountId = child(account, 'Id');
	const iban = text(child(accountId, 'IBAN'))?.replace(/\s+/g, '').toUpperCase() ?? null;
	const otherId = iban ? null : text(child(child(accountId, 'Othr'), 'Id'));
	if (!iban && !otherId) throw new ParseRefusal('parse_failed');

	const entries = children(statement, 'Ntry');
	const balances = children(statement, 'Bal');
	const accountCurrency =
		currency(text(child(account, 'Ccy'))) ??
		currency(child(entries[0] ?? null, 'Amt')?.getAttribute('Ccy') ?? null) ??
		currency(child(balances[0] ?? null, 'Amt')?.getAttribute('Ccy') ?? null);
	if (!accountCurrency) throw new ParseRefusal('parse_failed');

	const rows: (NormalizedRow & {units: bigint; scale: number})[] = [];
	let entriesSkipped = 0;
	for (const entry of entries) {
		if (entryStatus(entry) !== 'BOOK') {
			entriesSkipped++;
			continue;
		}
		rows.push(parseEntry(entry));
	}

	const bic = servicerBic(account);
	const {openingBalance, closingBalance, balanceAfter} = reconcileBalances(balances, rows, entryOrder(bic));
	return {
		format: 'camt053',
		layout: null,
		accountIban: iban,
		accountOtherId: otherId,
		bank: null,
		servicerBic: institutionBic(bic),
		accountCurrency,
		sequenceNumber: text(child(statement, 'ElctrncSeqNb')),
		entriesSkipped,
		openingBalance,
		closingBalance,
		rows: rows.map(({units: _units, scale: _scale, ...row}, index) => ({
			...row,
			balanceAfter: balanceAfter?.[index] ?? null,
		})),
	};
}

function entryStatus(entry: Element): string | null {
	const status = child(entry, 'Sts');
	// Later versions wrap the code: <Sts><Cd>BOOK</Cd></Sts>.
	return (text(child(status, 'Cd')) ?? text(status))?.toUpperCase() ?? null;
}

function parseEntry(entry: Element): NormalizedRow & {units: bigint; scale: number} {
	const amountElement = child(entry, 'Amt');
	const amountText = decimal(amountElement);
	const entryCurrency = currency(amountElement?.getAttribute('Ccy') ?? null);
	if (!amountText || !entryCurrency) throw new ParseRefusal('parse_failed');
	const indicator = text(child(entry, 'CdtDbtInd'))?.toUpperCase();
	if (indicator !== 'CRDT' && indicator !== 'DBIT') throw new ParseRefusal('parse_failed');

	const details = children(child(entry, 'NtryDtls'), 'TxDtls');
	const counterparty = agreed(details.map((detail) => counterpartyOf(detail, indicator)));
	const endToEndId = agreed(details.map((detail) => text(child(child(detail, 'Refs'), 'EndToEndId'))));
	const remittance = details.flatMap((detail) => remittanceLines(child(detail, 'RmtInf')));
	const ultimate = agreed(details.map((detail) => ultimatePartyOf(detail, indicator)));
	const counterpartyName = counterparty?.[0] ?? ultimate ?? null;
	const entryInformation = text(child(entry, 'AddtlNtryInf'));
	// An ultimate party behind a named one (a shop behind a payment provider) is kept in the text.
	const description =
		[entryInformation, ultimate !== counterpartyName ? ultimate : null].filter(Boolean).join(' ') || null;
	const domain = child(child(entry, 'BkTxCd'), 'Domn');
	const family = child(domain, 'Fmly');
	const unsigned = trimAmount(amountText);
	const signed = indicator === 'DBIT' && /[1-9]/.test(unsigned) ? `-${unsigned}` : unsigned;

	return {
		bookingDate: dateOf(child(entry, 'BookgDt')),
		valueDate: dateOf(child(entry, 'ValDt')),
		transactionDate: null,
		amount: signed,
		creditDebitIndicator: indicator,
		currency: entryCurrency,
		balanceAfter: null,
		bankReference: text(child(entry, 'AcctSvcrRef')),
		counterpartyName,
		counterpartyIban: counterparty?.[1] ?? null,
		remittanceInformation: remittance.length > 0 ? remittance.join(' ') : null,
		description,
		bankTransactionCode: text(child(family, 'Cd')),
		bankTransactionSubCode: text(child(family, 'SubFmlyCd')),
		referenceNumber: endToEndId && endToEndId.toUpperCase() !== NOT_PROVIDED ? endToEndId : null,
		units: toUnits(amountText, indicator),
		scale: fractionDigits(amountText),
	};
}

/** The other side of the payment: the creditor on a debit, the debtor on a credit. */
function counterpartyOf(detail: Element, indicator: 'CRDT' | 'DBIT'): [string | null, string | null] {
	const parties = child(detail, 'RltdPties');
	const [partyName, accountName] = indicator === 'DBIT' ? ['Cdtr', 'CdtrAcct'] : ['Dbtr', 'DbtrAcct'];
	const party = child(parties, partyName);
	// Later versions nest the party: <Cdtr><Pty><Nm>.
	const name = text(child(party, 'Nm')) ?? text(child(child(party, 'Pty'), 'Nm'));
	const iban =
		text(child(child(child(parties, accountName), 'Id'), 'IBAN'))
			?.replace(/\s+/g, '')
			.toUpperCase() ?? null;
	return [name, iban];
}

/**
 * The remittance text: the unstructured lines, then of each structured block its additional text and the creditor's
 * reference (a Belgian structured communication, an RF reference, a Swiss QR reference), as written.
 */
function remittanceLines(remittance: Element | null): string[] {
	const structured = children(remittance, 'Strd');
	return [
		...children(remittance, 'Ustrd').map(text),
		...structured.flatMap((block) => children(block, 'AddtlRmtInf').map(text)),
		...structured.map((block) => text(child(child(block, 'CdtrRefInf'), 'Ref'))),
	].filter((line): line is string => Boolean(line));
}

/** The party the payment is finally for (a debit) or from (a credit), when the file names one. */
function ultimatePartyOf(detail: Element, indicator: 'CRDT' | 'DBIT'): string | null {
	const party = child(child(detail, 'RltdPties'), indicator === 'DBIT' ? 'UltmtCdtr' : 'UltmtDbtr');
	return text(child(party, 'Nm')) ?? text(child(child(party, 'Pty'), 'Nm'));
}

/** The value every detail agrees on; null when there are no details or they differ. */
function agreed<T>(values: T[]): T | null {
	if (values.length === 0) return null;
	const [first] = values;
	return values.every((value) => JSON.stringify(value) === JSON.stringify(first)) ? first : null;
}

/** The BIC of the bank that holds the account: `Acct/Svcr/FinInstnId/BIC`, or `BICFI` in later versions. */
function servicerBic(account: Element | null): string | null {
	const institution = child(child(account, 'Svcr'), 'FinInstnId');
	return (text(child(institution, 'BIC')) ?? text(child(institution, 'BICFI')))?.toUpperCase() ?? null;
}

type EntryOrder = 'newest_first';

/**
 * How a bank orders the entries of one statement, by the servicer's BIC. The standard leaves the order open and
 * reconciling cannot tell (opening plus the sum equals closing in any order), so only banks whose order was checked
 * against the balances bank sync stored for the same transactions are listed.
 */
function entryOrder(bic: string | null): EntryOrder | null {
	// ABN AMRO lists entries newest first.
	if (bic?.startsWith('ABNA')) return 'newest_first';
	return null;
}

/**
 * The statement's stated balances and the balance after each row (in document order). A statement stating both an
 * opening and a closing balance must reconcile: the opening balance plus every booked entry equals the closing
 * balance, in whatever order the entries come, or the file is refused as damaged or altered. The balance after each
 * row is the running sum in booking order, so it needs a known entry order for several rows; without one every row
 * is left without a balance, since a missing balance is better than a wrong one.
 */
function reconcileBalances(
	balances: Element[],
	rows: {units: bigint; scale: number}[],
	order: EntryOrder | null,
): {openingBalance: StatementBalance | null; closingBalance: StatementBalance | null; balanceAfter: string[] | null} {
	const openingElement = balances.find((balance) => OPENING_BALANCE_TYPES.includes(balanceType(balance) ?? ''));
	const closingElement = balances.find((balance) => balanceType(balance) === CLOSING_BALANCE_TYPE);
	const opening = openingElement ? balanceAmount(openingElement) : null;
	const closing = closingElement ? balanceAmount(closingElement) : null;
	const scale = amountScale(...[opening, closing].flatMap((amount) => (amount ? [amount] : [])), ...rows);
	// A balance counts as stated with its day (`Dt/Dt`, or the date part of `Dt/DtTm`).
	const stated = (element: Element | undefined, amount: typeof opening): StatementBalance | null => {
		const date = element ? dateOf(child(element, 'Dt')) : null;
		return amount && date ? {date, amount: formatUnits(amount.units, scale)} : null;
	};
	const result = {
		openingBalance: stated(openingElement, opening),
		closingBalance: stated(closingElement, closing),
		balanceAfter: null,
	};
	if (!opening || !closing) return result;

	const total = rows.reduce((sum, row) => sum + row.units, opening.units);
	if (total !== closing.units) throw new ParseRefusal('parse_failed');
	if (rows.length > 1 && !order) return result;
	const bookingOrder = rows.map((_row, index) => index);
	if (order === 'newest_first') bookingOrder.reverse();
	let running = opening.units;
	const after: string[] = [];
	for (const index of bookingOrder) {
		running += rows[index].units;
		after[index] = formatUnits(running, scale);
	}
	return {...result, balanceAfter: after};
}

function balanceType(balance: Element): string | null {
	return text(child(child(child(balance, 'Tp'), 'CdOrPrtry'), 'Cd'))?.toUpperCase() ?? null;
}

function balanceAmount(balance: Element): {units: bigint; scale: number} | null {
	const amount = decimal(child(balance, 'Amt'));
	const indicator = text(child(balance, 'CdtDbtInd'))?.toUpperCase();
	if (!amount || (indicator !== 'CRDT' && indicator !== 'DBIT')) return null;
	return {units: toUnits(amount, indicator), scale: fractionDigits(amount)};
}

/** A `DECIMAL` amount as written, with the zero before the point; null for any other text. */
function decimal(element: Element | null): string | null {
	const value = text(element);
	if (!value || !DECIMAL.test(value)) return null;
	return value.startsWith('.') ? `0${value}` : value;
}

/** An unsigned `decimal` amount, signed by its credit/debit indicator. */
function toUnits(amount: string, indicator: 'CRDT' | 'DBIT'): bigint {
	const {units} = parseDecimal(amount, '.')!;
	return indicator === 'DBIT' ? -units : units;
}

function fractionDigits(amount: string): number {
	return parseDecimal(amount, '.')!.scale;
}

function trimAmount(amount: string): string {
	return amount.replace(/^0+(?=\d)/, '');
}

/** `Dt` as written without its time zone, if any, or the date part of `DtTm` as written; no timezone conversion. */
function dateOf(container: Element | null): string | null {
	const value =
		text(child(container, 'Dt'))?.replace(DATE_ZONE, '') ?? text(child(container, 'DtTm'))?.slice(0, 10) ?? null;
	return value === null ? null : checkedDate(value);
}

function currency(value: string | null): string | null {
	const normalized = value?.trim().toUpperCase() ?? null;
	return normalized && CURRENCY.test(normalized) ? normalized : null;
}

function text(element: Element | null): string | null {
	return element?.textContent?.trim() || null;
}
