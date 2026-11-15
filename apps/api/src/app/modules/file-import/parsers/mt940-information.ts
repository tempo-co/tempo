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
const SLASH_START = new RegExp(`^/(${SLASH_KEYS.join('|')})/`);
/** An IBAN-shaped account at the start of a line of free text, then the name. */
const LEADING_ACCOUNT = /^([A-Z]{2}\d{2}[A-Z0-9]{11,30})(?:\s+(.*))?$/;
/** MT940 lines are at most 65 characters, tag included; a full one may have been cut anywhere. */
const LINE_WIDTH = 65;
const NOT_PROVIDED = 'NOTPROVIDED';

/**
 * The counterparty and text of an MT940 `:86:` field (its lines, the first without the tag) in one of the three
 * published layouts banks use:
 *
 * - German `?nn` subfields (DK): posting text in `?00`, purpose in `?20` to `?29` and `?60` to `?63` with SEPA
 *   keywords such as `EREF+` and `SVWZ+`, the account in `?31` and the name in `?32` and `?33`. Lines are joined as
 *   written, and a subfield continues the one before it without a space only when that one is full.
 * - SWIFT-style codes (`/EREF/`, `/CNTP/account/BIC/name/city/`, `/BENM//NAME/`, `/ORDP//NAME/`, `/REMI/`): the
 *   field is written continuously, so lines are joined without a space.
 * - Free text: lines joined with a space. A first line that leads with an account, or that is followed by others
 *   without filling its width, names the counterparty.
 */
export function informationFields(lines: readonly string[]): InformationFields {
	const joined = lines.join('');
	const separator = GERMAN_LAYOUT.exec(joined)?.[1];
	if (separator) return germanFields(joined, separator);
	if (SLASH_START.test(joined.trimStart())) return slashFields(joined.trim());
	return freeTextFields(lines);
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

function slashFields(text: string): InformationFields {
	const values = splitOnKeys(text, SLASH_KEY, (value) => value.replace(/\/+$/, '').trim());
	// CNTP is account/BIC/name/city.
	const counterparty = values.get('CNTP')?.split('/') ?? [];
	const reference = values.get('EREF');
	return {
		counterpartyName: values.get('NAME') || counterparty[2]?.trim() || null,
		counterpartyIban: normalizeIban(values.get('IBAN') ?? counterparty[0]),
		remittanceInformation: remittance(values.get('REMI')),
		referenceNumber: reference && reference.toUpperCase() !== NOT_PROVIDED ? reference : null,
		description: text || null,
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

function freeTextFields(lines: readonly string[]): InformationFields {
	const trimmed = lines.map((line) => line.trim());
	const description = trimmed.filter(Boolean).join(' ') || null;
	const [first = '', ...rest] = trimmed;
	const account = LEADING_ACCOUNT.exec(first);
	// The tag `:86:` takes four characters of the first line.
	const firstIsItem = rest.some(Boolean) && lines[0].length + 4 < LINE_WIDTH;
	const name = account ? account[2]?.trim() : firstIsItem ? first : null;
	return {
		counterpartyName: name || null,
		counterpartyIban: normalizeIban(account?.[1]),
		remittanceInformation: null,
		referenceNumber: null,
		description,
	};
}
