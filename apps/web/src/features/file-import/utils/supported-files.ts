/** The standard statement formats the import reads, from any bank that offers them. */
export const STANDARD_FORMATS = ['CAMT.053', 'MT940', 'OFX and QFX'] as const;

export type BankExport = {
  bank: string;
  /** The files of that bank's export the import reads. */
  files: string;
  /** The ids of the API's CSV layouts for this export (`BankImportSummary.layout`). */
  layouts?: readonly string[];
};

/** The banks whose own exports the import reads, by bank name. */
export const BANK_EXPORTS: readonly BankExport[] = [
  {bank: 'ABN AMRO', files: 'TXT'},
  {bank: 'ASN Bank', files: 'CSV', layouts: ['asn-nl']},
  {bank: 'bunq', files: 'CSV', layouts: ['bunq-nl', 'bunq-en']},
  {bank: 'ING', files: 'CSV', layouts: ['ing-nl']},
  {bank: 'Knab', files: 'CSV', layouts: ['knab-nl']},
  {bank: 'Rabobank', files: 'CSV', layouts: ['rabobank-nl']},
  {bank: 'Revolut', files: 'CSV and Excel'},
];

/** The bank whose CSV export a layout id describes; null for a layout this list does not know. */
export function layoutBank(layout: string | null | undefined): string | null {
  if (!layout) return null;
  return BANK_EXPORTS.find(({layouts}) => layouts?.includes(layout))?.bank ?? null;
}
