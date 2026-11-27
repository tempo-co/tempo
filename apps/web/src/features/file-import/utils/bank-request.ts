import type {BankRequestFileType} from '@wisp/contracts';

/** The file types a "Tell us your bank" request offers, with their labels, in the order shown. */
export const BANK_REQUEST_FILE_TYPE_LABELS: Record<BankRequestFileType, string> = {
  csv: 'CSV',
  excel: 'Excel',
  camt: 'CAMT.053',
  mt940: 'MT940',
  ofx: 'OFX',
  qif: 'QIF',
  pdf: 'PDF only',
  other: 'Something else',
};
