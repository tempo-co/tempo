import type {BankRequestFileType} from '@tempo/contracts';

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

/** The countries a "Tell us your bank" request can name: the EEA, Switzerland and the United Kingdom. */
export const BANK_REQUEST_COUNTRIES = [
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
