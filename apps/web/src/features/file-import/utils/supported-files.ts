import {BANK_LIST} from '@tempo/contracts';

/** The standard statement formats the import reads, from any bank that offers them. */
export const STANDARD_FORMATS = ['CAMT.053', 'MT940', 'OFX and QFX'] as const;

/**
 * The bank whose export a built-in layout id describes (`BankImportSummary.layout`), without the list's note in
 * brackets; null for a layout no listed bank or several banks use.
 */
export function layoutBank(layout: string | null | undefined): string | null {
  if (!layout) return null;
  const banks = BANK_LIST.filter((bank) => bank.layouts.includes(layout));
  return banks.length === 1 ? banks[0].name.replace(/\s*\(.*\)$/, '') : null;
}
