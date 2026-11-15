import {normalizeIban} from '../../banking/own-transfer/iban';
import {DescriptionFields, splitOnKeys} from './abn-amro';

export type InformationFields = DescriptionFields & {description: string | null};

/** The German (DK) layout: a three-digit transaction code, then subfields `?nn`, `?` or another separator. */
const GERMAN_LAYOUT = /^\d{3}([^\p{L}\p{N}\s/.,:+\-'()])\d{2}/u;
/** A purpose or name subfield this long is full, so the next one continues it without a space. */
const GERMAN_SUBFIELD_WIDTH = 27;
const GERMAN_PURPOSE = /^(2\d|6[0-3])$/;
const GERMAN_NAME = /^3[23]$/;
const GERMAN_POSTING_TEXT = '00';
const GERMAN_ACCOUNT = '31';
const SEPA_KEYWORD = /^(EREF|KREF|MREF|CRED|DEBT|SVWZ|ABWA|ABWE|COAM|OAMT|IBAN|BIC)\+/;

/** The codes of the SWIFT-style layout (`/EREF/…/CNTP/…/REMI/…`), as the field guides of SWIFT and its banks name them. */
const SLASH_KEYS = [
	'EREF',
	'KREF',
	'MREF',
	'PREF',
	'MARF',
	'CSID',
	'CNTP',
	'BENM',
	'ORDP',
	'NAME',
	'ADDR',
	'IBAN',
	'BIC',
	'REMI',
	'ISDT',
	'RTRN',
	'PURP',
	'ULTC',
	'ULTD',
	'ULTB',
	'TRTP',
	'BUSP',
	'SVCL',
	'ACCW',
	'CHGS',
	'EXCH',
	'OCMT',
];
const SLASH_KEY = new RegExp(`/(${SLASH_KEYS.join('|')})/`, 'g');
/** The field starts with a code, with or without its leading slash. */
const SLASH_START = new RegExp(`^/?(${SLASH_KEYS.join('|')})/`);
/** An IBAN-shaped account at the start of a line of free text, then the name. */
const LEADING_ACCOUNT = /^([A-Z]{2}\d{2}[A-Z0-9]{11,30})(?:\s+(.*))?$/;
/**
 * The Polish keywords that name the other party in free text, up to the next `;`: the payer of a credit (`OD:`,
 * `Nadawca:`) and the payee of a debit (`DLA:`, `Odbiorca:`). The other direction's keyword names the account holder.
 */
const PARTY_KEYWORDS = {
	credit: /(?:^|[;\s])(?:OD|NADAWCA)\s*:([^;]*)/iu,
	debit: /(?:^|[;\s])(?:DLA|ODBIORCA)\s*:([^;]*)/iu,
};
const NOT_PROVIDED = 'NOTPROVIDED';

/**
 * The counterparty and text of an MT940 `:86:` field (its lines, the first without the tag) in one of the three
 * published layouts banks use:
 *
 * - German `?nn` subfields (DK): posting text in `?00`, purpose in `?20` to `?29` and `?60` to `?63` with SEPA
 *   keywords such as `EREF+` and `SVWZ+`, the account in `?31` and the name in `?32` and `?33`. Lines are joined as
 *   written, and a subfield continues the one before it without a space only when that one is full.
 * - SWIFT-style codes (`/EREF/`, `/CNTP/account/BIC/name/city/`, `/BENM//NAME/`, `/ORDP//NAME/`, `/REMI/`, and
 *   `/ORDP/name?city` on a credit or `/BENM/name?account` on a debit, `?` standing for a line break), the first
 *   code's slash sometimes left out: the field is written continuously, so lines are joined without a space. The
 *   description is the values without their codes.
 * - Free text: lines joined with a space. A first line that leads with an account names the counterparty, and so do
 *   the Polish keywords (`PARTY_KEYWORDS`); other free text names none, since banks' narrative takes any shape.
 */
export function informationFields(lines: readonly string[], credit: boolean): InformationFields {
	const joined = lines.join('');
	const separator = GERMAN_LAYOUT.exec(joined)?.[1];
	if (separator) return germanFields(joined, separator);
	const trimmed = joined.trim();
	if (SLASH_START.test(trimmed)) return slashFields(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, credit);
	return freeTextFields(lines, credit);
}

function germanFields(text: string, separator: string): InformationFields {
	const subfields = text
		.split(separator)
		.slice(1)
		.map((part) => ({code: part.slice(0, 2), value: part.slice(2)}));
	const values = (pattern: RegExp) => subfields.filter(({code}) => pattern.test(code)).map(({value}) => value);
	// A SEPA keyword starts a subfield of its own; any other subfield continues the element before it.
	const elements: {keyword: string | null; subfields: string[]}[] = [];
	for (const value of values(GERMAN_PURPOSE)) {
		const keyword = SEPA_KEYWORD.exec(value)?.[1] ?? null;
		if (keyword || elements.length === 0) elements.push({keyword, subfields: [value]});
		else elements.at(-1)!.subfields.push(value);
	}
	const elementText = ({keyword, subfields: parts}: (typeof elements)[number]) =>
		joinSubfields(parts).slice(keyword ? keyword.length + 1 : 0);
	const element = (keyword: string) => {
		const found = elements.find((candidate) => candidate.keyword === keyword);
		return found ? clean(elementText(found)) : null;
	};
	const purpose = clean(elements.map((found) => joinSubfields(found.subfields)).join(' '));
	const reference = element('EREF');
	const hasKeywords = elements.some(({keyword}) => keyword);
	return {
		counterpartyName: clean(joinSubfields(values(GERMAN_NAME))),
		counterpartyIban: normalizeIban(subfields.find(({code}) => code === GERMAN_ACCOUNT)?.value),
		remittanceInformation: hasKeywords ? element('SVWZ') : purpose,
		referenceNumber: reference && reference.toUpperCase() !== NOT_PROVIDED ? reference : null,
		description: clean([subfields.find(({code}) => code === GERMAN_POSTING_TEXT)?.value, purpose].join(' ')),
	};
}

/** Subfields as one text: a full subfield runs on into the next as written, a shorter one is followed by a space. */
function joinSubfields(subfields: readonly string[]): string {
	return subfields
		.map((value, index) =>
			index < subfields.length - 1 && value.length < GERMAN_SUBFIELD_WIDTH ? `${value} ` : value,
		)
		.join('');
}

function clean(text: string | null | undefined): string | null {
	return text?.replace(/\s+/g, ' ').trim() || null;
}

function slashFields(text: string, credit: boolean): InformationFields {
	const cleanValue = (value: string) => value.replace(/\/+$/, '').trim();
	const values = splitOnKeys(text, SLASH_KEY, cleanValue);
	// CNTP is account/BIC/name/city.
	const counterparty = values.get('CNTP')?.split('/') ?? [];
	// Without a NAME code, the payer (credit) or payee (debit) code holds the name, then `?` and the city or account.
	const party = values
		.get(credit ? 'ORDP' : 'BENM')
		?.split('?')[0]
		.trim();
	const reference = values.get('EREF');
	const matches = [...text.matchAll(SLASH_KEY)];
	const description = matches.map((match, index) => {
		const value = cleanValue(text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length));
		if (value.toUpperCase() === NOT_PROVIDED) return null;
		if (match[1] === 'REMI') return remittance(value);
		return match[1] === 'CNTP' ? value.split('/').join(' ') : value;
	});
	return {
		counterpartyName: values.get('NAME') || counterparty[2]?.trim() || party || null,
		counterpartyIban: normalizeIban(values.get('IBAN') ?? counterparty[0]),
		remittanceInformation: remittance(values.get('REMI')),
		referenceNumber: reference && reference.toUpperCase() !== NOT_PROVIDED ? reference : null,
		description: clean(description.filter(Boolean).join(' ')),
	};
}

/** `/REMI/` holds the text, or `USTD//text` (unstructured) or `STRD/issuer type/reference` (structured). */
function remittance(value: string | undefined): string | null {
	if (!value) return null;
	const unstructured = /^USTD\/+(.*)$/s.exec(value);
	if (unstructured) return unstructured[1].trim() || null;
	const structured = /^STRD\/(?:[^/]*\/+)?(.*)$/s.exec(value);
	if (structured) return structured[1].trim() || null;
	return value;
}

function freeTextFields(lines: readonly string[], credit: boolean): InformationFields {
	const trimmed = lines.map((line) => line.trim());
	const description = trimmed.filter(Boolean).join(' ') || null;
	const account = LEADING_ACCOUNT.exec(trimmed[0] ?? '');
	const keyword = PARTY_KEYWORDS[credit ? 'credit' : 'debit'].exec(description ?? '')?.[1];
	return {
		counterpartyName: clean(account ? account[2] : keyword),
		counterpartyIban: normalizeIban(account?.[1]),
		remittanceInformation: null,
		referenceNumber: null,
		description,
	};
}
