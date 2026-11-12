import {type Element} from '@xmldom/xmldom';

import {checkedDate} from './dates';
import {amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal} from './parse-result';
import {child, children, parseXml} from './xml';

const CAMT053_NAMESPACE = /^urn:iso:std:iso:20022:tech:xsd:camt\.053\.001\.\d+$/;
const CAMT053_NAMESPACE_PREFIX = 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.';
const SNIFF_BYTES = 4096;
const DECIMAL = /^\d{1,15}(\.\d{1,8})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const ENCODING_DECLARATION = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/;
const OPENING_BALANCE_TYPES = ['PRCD', 'OPBD'];
const CLOSING_BALANCE_TYPE = 'CLBD';
const NOT_PROVIDED = 'NOTPROVIDED';

/**
 * A quick look at the first bytes: markup that names the CAMT.053 namespace. `parseCamt053` still checks that the
 * root is `Document` in that namespace, so camt.052, camt.054 and other XML stay unsupported.
 */
export function looksLikeCamt053(bytes: Uint8Array): boolean {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, SNIFF_BYTES))
		.toString('latin1')
		.replace(/^\u00ef\u00bb\u00bf/, '');
	return head.trimStart().startsWith('<') && head.includes(CAMT053_NAMESPACE_PREFIX);
}

/**
 * Reads a bank-to-customer statement (CAMT.053, any `camt.053.001.*` version) into one normalized statement per
 * `Stmt`. Documents declaring a DTD or entities are refused (see `parseXml`).
 */
export function parseCamt053(bytes: Uint8Array): NormalizedStatement[] {
	const root = parseXml(decode(bytes));
	if (!root || root.localName !== 'Document' || !CAMT053_NAMESPACE.test(root.namespaceURI ?? '')) {
		throw new ParseRefusal('unsupported_format');
	}

	const report = child(root, 'BkToCstmrStmt');
	if (!report) throw new ParseRefusal('parse_failed');
	return children(report, 'Stmt').map(parseStatement);
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

	const balanceAfter = reconcileBalances(balances, rows, entryOrder(servicerBic(account)));
	return {
		format: 'camt053',
		accountIban: iban,
		accountOtherId: otherId,
		bank: null,
		accountCurrency,
		sequenceNumber: text(child(statement, 'ElctrncSeqNb')),
		entriesSkipped,
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
	const amountText = text(amountElement);
	const entryCurrency = currency(amountElement?.getAttribute('Ccy') ?? null);
	if (!amountText || !DECIMAL.test(amountText) || !entryCurrency) throw new ParseRefusal('parse_failed');
	const indicator = text(child(entry, 'CdtDbtInd'))?.toUpperCase();
	if (indicator !== 'CRDT' && indicator !== 'DBIT') throw new ParseRefusal('parse_failed');

	const details = children(child(entry, 'NtryDtls'), 'TxDtls');
	const counterparty = agreed(details.map((detail) => counterpartyOf(detail, indicator)));
	const endToEndId = agreed(details.map((detail) => text(child(child(detail, 'Refs'), 'EndToEndId'))));
	const remittance = details
		.flatMap((detail) => children(child(detail, 'RmtInf'), 'Ustrd').map(text))
		.filter((line): line is string => Boolean(line));
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
		counterpartyName: counterparty?.[0] ?? null,
		counterpartyIban: counterparty?.[1] ?? null,
		remittanceInformation: remittance.length > 0 ? remittance.join(' ') : null,
		description: text(child(entry, 'AddtlNtryInf')),
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
 * The balance after each row (in document order): the opening balance plus the running sum in booking order, kept
 * only when the last one equals the closing balance exactly. Several rows need a known entry order; without one
 * every row is left without a balance, since a missing balance is better than a wrong one.
 */
function reconcileBalances(
	balances: Element[],
	rows: {units: bigint; scale: number}[],
	order: EntryOrder | null,
): string[] | null {
	if (rows.length > 1 && !order) return null;
	const opening = balances.find((balance) => OPENING_BALANCE_TYPES.includes(balanceType(balance) ?? ''));
	const closing = balances.find((balance) => balanceType(balance) === CLOSING_BALANCE_TYPE);
	if (!opening || !closing) return null;
	const openingAmount = balanceAmount(opening);
	const closingAmount = balanceAmount(closing);
	if (!openingAmount || !closingAmount) return null;

	const scale = amountScale(openingAmount, closingAmount, ...rows);
	const bookingOrder = rows.map((_row, index) => index);
	if (order === 'newest_first') bookingOrder.reverse();
	let running = openingAmount.units;
	const after: string[] = [];
	for (const index of bookingOrder) {
		running += rows[index].units;
		after[index] = formatUnits(running, scale);
	}
	return running === closingAmount.units ? after : null;
}

function balanceType(balance: Element): string | null {
	return text(child(child(child(balance, 'Tp'), 'CdOrPrtry'), 'Cd'))?.toUpperCase() ?? null;
}

function balanceAmount(balance: Element): {units: bigint; scale: number} | null {
	const amount = text(child(balance, 'Amt'));
	const indicator = text(child(balance, 'CdtDbtInd'))?.toUpperCase();
	if (!amount || !DECIMAL.test(amount) || (indicator !== 'CRDT' && indicator !== 'DBIT')) return null;
	return {units: toUnits(amount, indicator), scale: fractionDigits(amount)};
}

/** An unsigned `DECIMAL` amount, signed by its credit/debit indicator. */
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

/** `Dt` as written, or the date part of `DtTm` as written; no timezone conversion. */
function dateOf(container: Element | null): string | null {
	const value = text(child(container, 'Dt')) ?? text(child(container, 'DtTm'))?.slice(0, 10) ?? null;
	return value === null ? null : checkedDate(value);
}

function currency(value: string | null): string | null {
	const normalized = value?.trim().toUpperCase() ?? null;
	return normalized && CURRENCY.test(normalized) ? normalized : null;
}

function text(element: Element | null): string | null {
	return element?.textContent?.trim() || null;
}
