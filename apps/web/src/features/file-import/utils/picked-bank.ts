import {BANK_LIST, type Bank} from '@tempo/contracts';

import {countryName} from '@/utils/countries';
import {matchesSearch} from '@/utils/text-search';

/** The bank the owner picked: a `BANK_LIST` id or `OTHER_BANK_ID`; null when they picked none, as for a page drop. */
export type PickedBankId = string | null;

/** The listed bank a pick names; null for Another bank or no pick. */
export function pickedBank(id: PickedBankId): Bank | null {
  return BANK_LIST.find((bank) => bank.id === id) ?? null;
}

/** Where a bank serves its customers, as its row's second line reads. */
export function bankWhere(bank: Pick<Bank, 'country'>) {
  return bank.country ? countryName(bank.country) : 'Several countries';
}

/** The listed banks a search finds, by name or country, in their two groups and the list's own order. */
export function bankGroups(query: string) {
  const found = BANK_LIST.filter((bank) => matchesSearch(`${bank.name} ${bankWhere(bank)}`, query));
  return {
    verified: found.filter((bank) => bank.status === 'verified'),
    unverified: found.filter((bank) => bank.status === 'unverified'),
  };
}
