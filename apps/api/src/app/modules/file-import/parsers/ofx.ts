import {normalizeIban} from '../../banking/own-transfer/iban';
import {checkedDate} from './dates';
import {amountScale, formatUnits, parseDecimal} from './decimal';
import {NormalizedRow, NormalizedStatement, ParseRefusal} from './parse-result';

const SNIFF_BYTES = 4096;
const CURRENCY = /^[A-Z]{3}$/;
/** `YYYYMMDD`, then optionally `HHMMSS[.XXX]` and a `[offset:zone]`; only the date part is used. */
const OFX_DATE =
	/^(\d{4})(\d{2})(\d{2})(?:\d{4}(?:\d{2}(?:\.\d{1,3})?)?)?(?:\s*\[[+-]?\d{1,2}(?:\.\d{1,2})?(?::[A-Za-z]{1,8})?\])?$/;
const TAG_NAME = /^[A-Za-z][A-Za-z0-9._]*$/;
/** How the file begins: the 1.x header, the 2.x declarations, or the root element itself. */
const OFX_PROLOGUE = /^(?:OFXHEADER\s*:|(?:<\?xml\b[^>]*\?>\s*)?<\?OFX\b|<OFX\s*>)/i;
const MAX_DEPTH = 256;
/**
 * The aggregates the reader walks through. Only a document type definition tells an aggregate from an SGML leaf
 * left empty, so these must be closed by their own end tag; any other element an ancestor's end tag closes was a
 * leaf.
 */
const READ_AGGREGATES = new Set([
	'BANKMSGSRSV1',
	'STMTTRNRS',
	'STMTRS',
	'BANKACCTFROM',
	'CREDITCARDMSGSRSV1',
	'CCSTMTTRNRS',
	'CCSTMTRS',
	'CCACCTFROM',
	'BANKTRANLIST',
	'STMTTRN',
	'PAYEE',
]);
const ENTITIES: Record<string, string> = {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'"};

/** An OFX element: an aggregate holds elements, a leaf holds a value. */
type OfxElement = {name: string; children: OfxElement[]; value: string | null};

/**
 * A quick look at how the file begins: the OFX 1.x header (`OFXHEADER:`), the OFX 2.x processing instruction
 * (`<?OFX`, after an optional XML declaration) or an `<OFX>` root. QFX files are OFX files with extra vendor
 * elements.
 */
export function looksLikeOfx(bytes: Uint8Array): boolean {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, SNIFF_BYTES))
		.toString('latin1')
		.replace(/^\u00ef\u00bb\u00bf/, '');
	return OFX_PROLOGUE.test(head.trimStart());
}

/**
 * Reads the bank statements (`STMTRS`) and card statements (`CCSTMTRS`) of an OFX or QFX file, version 1.x (SGML,
 * leaf elements left unclosed) or 2.x (XML), into one normalized statement each. Elements Tempo does not use,
 * including vendor elements, are skipped. Markup declarations (a DTD, entities, comments) are refused, and only the
 * predefined and numeric character references are decoded. A statement without a currency is `parse_failed`.
 */
export function parseOfx(bytes: Uint8Array): NormalizedStatement[] {
	const root = parseOfxTree(decode(bytes));
	const statements = [
		...descendants(root, ['BANKMSGSRSV1', 'STMTTRNRS', 'STMTRS']).map((statement) =>
			parseStatement(statement, 'BANKACCTFROM'),
		),
		...descendants(root, ['CREDITCARDMSGSRSV1', 'CCSTMTTRNRS', 'CCSTMTRS']).map((statement) =>
			parseStatement(statement, 'CCACCTFROM'),
		),
	];
	if (statements.length === 0) throw new ParseRefusal('unsupported_format');
	return statements;
}

/**
 * The text in the encoding the file declares: the 1.x header's `CHARSET:1252` or `CHARSET:8859-1` (both read as
 * Windows-1252, which the latter is a subset of), else UTF-8, which 2.x files declare and ASCII is part of.
 */
function decode(bytes: Uint8Array): string {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, SNIFF_BYTES)).toString(
		'latin1',
	);
	const encoding = /^\s*ENCODING\s*:\s*(\S+)/im.exec(head)?.[1].toUpperCase();
	const charset = /^\s*CHARSET\s*:\s*(\S+)/im.exec(head)?.[1].toUpperCase();
	const label = encoding !== 'UTF-8' && (charset === '1252' || charset === '8859-1') ? 'windows-1252' : 'utf-8';
	try {
		return new TextDecoder(label, {fatal: true}).decode(bytes);
	} catch {
		throw new ParseRefusal('parse_failed');
	}
}

/**
 * The `OFX` element as a tree. Text right after an element's tag makes it a leaf, which the next tag ends whether or
 * not it is an end tag (SGML leaves have none). An end tag closes the element it names and every element opened
 * after it. One of those that holds no text was an SGML leaf left empty (aggregates always have an end tag), so the
 * elements read into it belong to its parent, after it; one of the aggregates the reader walks is refused instead.
 */
function parseOfxTree(text: string): OfxElement {
	const start = /<OFX\s*>/i.exec(text);
	if (!start) throw new ParseRefusal('unsupported_format');
	if (/<!/.test(text)) throw new ParseRefusal('parse_failed');
	const root: OfxElement = {name: 'OFX', children: [], value: null};
	const open: OfxElement[] = [root];
	let index = start.index + start[0].length;
	while (open.length > 0) {
		const tagStart = text.indexOf('<', index);
		if (tagStart === -1) throw new ParseRefusal('parse_failed');
		const content = text.slice(index, tagStart).trim();
		const tagEnd = text.indexOf('>', tagStart);
		if (tagEnd === -1) throw new ParseRefusal('parse_failed');
		const tag = text.slice(tagStart + 1, tagEnd).trim();
		index = tagEnd + 1;
		const current = open.at(-1)!;
		if (content) {
			// Text belongs to the element just opened, which makes it a leaf.
			if (current === root || current.children.length > 0 || current.value !== null) {
				throw new ParseRefusal('parse_failed');
			}
			current.value = decodeReferences(content);
		}
		if (tag.startsWith('?')) continue;
		if (tag.startsWith('/')) {
			const name = tag.slice(1).trim().toUpperCase();
			const position = open.findLastIndex((element) => element.name === name);
			if (position === -1) throw new ParseRefusal('parse_failed');
			// Innermost first, so elements move up through every empty leaf they were read into.
			for (let inner = open.length - 1; inner > position; inner--) {
				const element = open[inner];
				if (READ_AGGREGATES.has(element.name)) throw new ParseRefusal('parse_failed');
				const parent = open[inner - 1].children;
				parent.splice(parent.indexOf(element) + 1, 0, ...element.children.splice(0));
			}
			open.length = position;
			continue;
		}
		const selfClosing = tag.endsWith('/');
		const name = (selfClosing ? tag.slice(0, -1) : tag).trim();
		if (!TAG_NAME.test(name)) throw new ParseRefusal('parse_failed');
		// A leaf with text has ended at this tag.
		if (current.value !== null) open.pop();
		const element: OfxElement = {name: name.toUpperCase(), children: [], value: null};
		open.at(-1)!.children.push(element);
		if (!selfClosing) open.push(element);
		if (open.length > MAX_DEPTH) throw new ParseRefusal('parse_failed');
	}
	if (text.slice(index).trim()) throw new ParseRefusal('parse_failed');
	return root;
}

/** Decodes `&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;` and numeric references once; any other `&` stays as written. */
function decodeReferences(value: string): string {
	return value.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (reference, name: string) => {
		if (!name.startsWith('#')) return ENTITIES[name.toLowerCase()] ?? reference;
		const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
		return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
			? String.fromCodePoint(code)
			: reference;
	});
}

function parseStatement(statement: OfxElement, accountElement: 'BANKACCTFROM' | 'CCACCTFROM'): NormalizedStatement {
	const accountCurrency = value(statement, 'CURDEF')?.toUpperCase() ?? null;
	if (!accountCurrency || !CURRENCY.test(accountCurrency)) throw new ParseRefusal('parse_failed');
	const accountId = value(child(statement, accountElement), 'ACCTID');
	if (!accountId) throw new ParseRefusal('parse_failed');
	const iban = normalizeIban(accountId);
	return {
		format: 'ofx',
		layout: null,
		accountIban: iban,
		accountOtherId: iban ? null : accountId,
		bank: null,
		accountCurrency,
		sequenceNumber: null,
		entriesSkipped: 0,
		rows: children(child(statement, 'BANKTRANLIST'), 'STMTTRN').map((transaction) =>
			parseTransaction(transaction, accountCurrency),
		),
	};
}

function parseTransaction(transaction: OfxElement, currency: string): NormalizedRow {
	const amountText = value(transaction, 'TRNAMT') ?? '';
	// Some banks write a decimal comma.
	const amount = parseDecimal(amountText, '.') ?? parseDecimal(amountText, ',');
	const bookingDate = date(value(transaction, 'DTPOSTED'));
	if (!amount || !bookingDate) throw new ParseRefusal('parse_failed');
	return {
		bookingDate,
		valueDate: null,
		transactionDate: date(value(transaction, 'DTUSER')),
		amount: formatUnits(amount.units, amountScale(amount)),
		creditDebitIndicator: amount.units < 0n ? 'DBIT' : 'CRDT',
		currency,
		balanceAfter: null,
		bankReference: value(transaction, 'FITID'),
		counterpartyName: value(transaction, 'NAME') ?? value(child(transaction, 'PAYEE'), 'NAME'),
		counterpartyIban: null,
		remittanceInformation: value(transaction, 'MEMO'),
		description: null,
		bankTransactionCode: value(transaction, 'TRNTYPE'),
		bankTransactionSubCode: null,
		referenceNumber: null,
	};
}

/** The date part of an OFX date and time as written, without moving it by the zone offset. */
function date(text: string | null): string | null {
	if (text === null) return null;
	const parts = OFX_DATE.exec(text);
	if (!parts) throw new ParseRefusal('parse_failed');
	return checkedDate(`${parts[1]}-${parts[2]}-${parts[3]}`);
}

/** The elements at the end of a path of child names, below `root`. */
function descendants(root: OfxElement, path: readonly string[]): OfxElement[] {
	return path.reduce<OfxElement[]>(
		(elements, name) => elements.flatMap((element) => children(element, name)),
		[root],
	);
}

function children(parent: OfxElement | null, name: string): OfxElement[] {
	return parent?.children.filter((element) => element.name === name) ?? [];
}

function child(parent: OfxElement | null, name: string): OfxElement | null {
	return children(parent, name)[0] ?? null;
}

function value(parent: OfxElement | null, name: string): string | null {
	return child(parent, name)?.value?.trim() || null;
}
