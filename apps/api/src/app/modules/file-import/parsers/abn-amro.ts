import {ibanRemainder, isValidIban, normalizeIban} from '../../banking/own-transfer/iban';

/** The BIC ABN AMRO writes as the header of each MT940 statement. */
export const ABN_AMRO_BIC = 'ABNANL2A';

/**
 * The IBAN of an ABN AMRO account number, as ABN AMRO's own exports write it (no IBAN, up to 10 digits): `NL`,
 * the check digits, `ABNA` and the number padded to 10 digits. Null when the result fails the IBAN check.
 */
export function abnAmroIban(accountNumber: string): string | null {
	if (!/^\d{1,10}$/.test(accountNumber)) return null;
	const bban = `ABNA${accountNumber.padStart(10, '0')}`;
	const iban = `NL${String(98 - ibanRemainder(`${bban}NL00`)).padStart(2, '0')}${bban}`;
	return isValidIban(iban) ? iban : null;
}

export type DescriptionFields = {
	counterpartyName: string | null;
	counterpartyIban: string | null;
	remittanceInformation: string | null;
	referenceNumber: string | null;
};

const NO_FIELDS: DescriptionFields = {
	counterpartyName: null,
	counterpartyIban: null,
	remittanceInformation: null,
	referenceNumber: null,
};
const SLASH_KEYS = ['TRTP', 'IBAN', 'BIC', 'NAME', 'REMI', 'EREF', 'CSID', 'MARF', 'ORDP', 'BENM', 'ISDT', 'PREF'];
const SLASH_KEY = new RegExp(`/(${SLASH_KEYS.join('|')})/`, 'g');
const SLASH_START = new RegExp(`^/(${SLASH_KEYS.join('|')})/`);
const SEPA_LABEL = /(?<=^|\s)(IBAN|BIC|Naam|Omschrijving|Kenmerk|Machtiging|Incassant):/gi;
const NOT_PROVIDED = 'NOTPROVIDED';

/**
 * The counterparty ABN AMRO writes into the description of its MT940 and TXT exports, in one of two shapes:
 * `/TRTP/…/IBAN/…/NAME/…/REMI/…/EREF/…` (split on the known keys only, since a value may hold `/`), or
 * `SEPA …  IBAN: …  Naam: …  Omschrijving: …` (labels in any case, values with runs of spaces collapsed). Any other
 * text (card payments, bank fees) names no counterparty. An IBAN that fails its check is left out.
 */
export function abnAmroDescriptionFields(text: string): DescriptionFields {
	if (SLASH_START.test(text)) {
		const values = splitOnKeys(text, SLASH_KEY, (value) => value.trim());
		const reference = values.get('EREF');
		return {
			counterpartyName: values.get('NAME') || null,
			counterpartyIban: normalizeIban(values.get('IBAN')),
			remittanceInformation: values.get('REMI') || null,
			referenceNumber: reference && reference.toUpperCase() !== NOT_PROVIDED ? reference : null,
		};
	}
	if (/^SEPA\s/i.test(text)) {
		const values = splitOnKeys(text, SEPA_LABEL, (value) => value.trim().replace(/\s+/g, ' '));
		return {
			counterpartyName: values.get('NAAM') || null,
			counterpartyIban: normalizeIban(values.get('IBAN')),
			remittanceInformation: values.get('OMSCHRIJVING') || null,
			referenceNumber: null,
		};
	}
	return NO_FIELDS;
}

/** Each key's first value (keys upper case): the text from after the key up to the next key or the end. */
function splitOnKeys(text: string, keys: RegExp, clean: (value: string) => string): Map<string, string> {
	const matches = [...text.matchAll(keys)];
	const values = new Map<string, string>();
	for (const [index, match] of matches.entries()) {
		const key = match[1].toUpperCase();
		// The slash that closes a value opens the next key.
		const end = matches[index + 1]?.index ?? text.length;
		if (!values.has(key)) values.set(key, clean(text.slice(match.index + match[0].length, end)));
	}
	return values;
}
