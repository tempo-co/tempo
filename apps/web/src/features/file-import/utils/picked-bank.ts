import {BANK_LIST, type Bank, bankNameKey} from '@wisp/contracts';

import {browserRegion, countryName} from '@/utils/countries';
import {matchesSearch} from '@/utils/text-search';

/** The bank the owner picked: a `BANK_LIST` id or `OTHER_BANK_ID`; null when they picked none, as for a page drop. */
export type PickedBankId = string | null;

/** What the steps of a listed bank no file of which has been read yet (an unverified bank) say about it. */
export const UNTESTED_NOTE =
  "We haven't seen a file from this bank yet. If we can't read it straight away, we'll ask you to check its columns once.";

/** The listed bank a pick names; null for Another bank or no pick. */
export function pickedBank(id: PickedBankId): Bank | null {
  return BANK_LIST.find((bank) => bank.id === id) ?? null;
}

/** A listed bank's name without the list's note in brackets ("ASN Bank" for "ASN Bank (also SNS and RegioBank)"). */
export function bankShortName(bank: Pick<Bank, 'name'>) {
  return bank.name.replace(/\s*\(.*\)$/, '');
}

/** Where a bank serves its customers, as its row's second line reads. */
export function bankWhere(bank: Pick<Bank, 'country'>) {
  return bank.country ? countryName(bank.country) : 'Several countries';
}

/** The countries the bank picker and a "Tell us your bank" request offer: the EEA, Switzerland and the United Kingdom. */
export const PICKER_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'CH',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
] as const;

/** Whether the picker lists `code`. */
export const isPickerCountry = (code: string) =>
  (PICKER_COUNTRIES as readonly string[]).includes(code);

/** The picker's countries by name, as its country step lists them, each with how many listed banks it has. */
export const PICKER_COUNTRY_OPTIONS = PICKER_COUNTRIES.map((code) => ({
  code,
  label: countryName(code),
  bankCount: BANK_LIST.filter((bank) => bank.country === code).length,
})).sort((left, right) => left.label.localeCompare(right.label));

/** The picker's countries by the IANA time zones that lie in them. */
const TIME_ZONE_COUNTRIES: Record<string, (typeof PICKER_COUNTRIES)[number]> = {
  'Europe/Vienna': 'AT',
  'Europe/Brussels': 'BE',
  'Europe/Sofia': 'BG',
  'Europe/Zurich': 'CH',
  'Asia/Nicosia': 'CY',
  'Asia/Famagusta': 'CY',
  'Europe/Nicosia': 'CY',
  'Europe/Prague': 'CZ',
  'Europe/Berlin': 'DE',
  'Europe/Busingen': 'DE',
  'Europe/Copenhagen': 'DK',
  'Europe/Tallinn': 'EE',
  'Europe/Madrid': 'ES',
  'Africa/Ceuta': 'ES',
  'Atlantic/Canary': 'ES',
  'Europe/Helsinki': 'FI',
  'Europe/Paris': 'FR',
  'Europe/London': 'GB',
  'Europe/Athens': 'GR',
  'Europe/Zagreb': 'HR',
  'Europe/Budapest': 'HU',
  'Europe/Dublin': 'IE',
  'Atlantic/Reykjavik': 'IS',
  'Europe/Rome': 'IT',
  'Europe/Vaduz': 'LI',
  'Europe/Vilnius': 'LT',
  'Europe/Luxembourg': 'LU',
  'Europe/Riga': 'LV',
  'Europe/Malta': 'MT',
  'Europe/Amsterdam': 'NL',
  'Europe/Oslo': 'NO',
  'Europe/Warsaw': 'PL',
  'Europe/Lisbon': 'PT',
  'Atlantic/Azores': 'PT',
  'Atlantic/Madeira': 'PT',
  'Europe/Bucharest': 'RO',
  'Europe/Stockholm': 'SE',
  'Europe/Ljubljana': 'SI',
  'Europe/Bratislava': 'SK',
};

/**
 * The country the picker opens at: the browser's region when the picker lists it, else the country of the account's
 * time zone when the picker lists it, else the first by name.
 */
export function likelyPickerCountry(timeZone: string | undefined): string {
  return (
    browserRegion(isPickerCountry) ??
    (timeZone ? TIME_ZONE_COUNTRIES[timeZone] : undefined) ??
    PICKER_COUNTRY_OPTIONS[0].code
  );
}

/**
 * The listed banks the picker shows: with no search, the chosen country's banks, then the banks that serve several
 * countries from one app; a search finds the banks of every country by name or country. Both keep the list's order.
 */
export function pickerBanks(country: string, query: string): readonly Bank[] {
  if (query.trim())
    return BANK_LIST.filter((bank) => matchesSearch(`${bank.name} ${bankWhere(bank)}`, query));
  return [
    ...BANK_LIST.filter((bank) => bank.country === country),
    ...BANK_LIST.filter((bank) => bank.country === null),
  ];
}

/** A bank in the catalog of connectable banks. */
type CatalogBank = {name: string; country: string};

/**
 * The connectable bank whose logo a listed bank shows: the one of the same name (ignoring case, spacing and a note in
 * brackets) in the bank's country, or for a bank of several countries its `logoCountry`. Undefined when none is.
 */
export function catalogMatch<T extends CatalogBank>(
  bank: Pick<Bank, 'name' | 'country' | 'logoCountry'>,
  catalog: readonly T[],
): T | undefined {
  const country = bank.country ?? bank.logoCountry;
  if (!country) return undefined;
  const name = bankNameKey(bankShortName(bank));
  return catalog.find((entry) => entry.country === country && bankNameKey(entry.name) === name);
}
