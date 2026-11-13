import type {
  BankImportLayoutField,
  BankImportLayoutMapping,
  BankImportLayoutPreviewRow,
} from '@tempo/contracts';

const FIELD_NAMES: Record<BankImportLayoutField, string> = {
  date: 'Date',
  valueDate: 'Value date',
  amount: 'Amount',
  direction: 'Money in or out',
  moneyOut: 'Money out',
  moneyIn: 'Money in',
  balance: 'Balance',
  currency: 'Currency',
  account: 'Account',
  counterparty: 'Name',
  counterpartyAccount: 'Their account',
  description: 'Description',
};

/** `column 4`, `columns 4 and 5`, `columns 3, 4 and 6`. */
function columnsInWords(columns: number[]) {
  if (columns.length === 1) return `column ${columns[0]}`;
  return `columns ${columns.slice(0, -1).join(', ')} and ${columns[columns.length - 1]}`;
}

/**
 * A proposed layout in words, one part per field in the order the API lists them: `Date: column 1 · Amount:
 * column 4, negative for money out · …`.
 */
export function mappingInWords(mapping: BankImportLayoutMapping): string[] {
  const fields = new Map<BankImportLayoutField, number[]>();
  for (const {field, column} of mapping.columns)
    fields.set(field, [...(fields.get(field) ?? []), column]);

  const parts = [...fields].map(([field, columns]) => {
    const words = `${FIELD_NAMES[field]}: ${columnsInWords(columns)}`;
    if (field === 'amount' && mapping.amount === 'signed')
      return `${words}, negative for money out`;
    if (field === 'direction' && mapping.direction)
      return `${words}, “${mapping.direction.moneyOut}” for money out and “${mapping.direction.moneyIn}” for money in`;
    if (field === 'balance' && mapping.balance)
      return `${words}, ${mapping.balance === 'after' ? 'after' : 'before'} each transaction`;
    return words;
  });
  if (mapping.accountLine !== null)
    parts.push(`Account: line ${mapping.accountLine} above the table`);
  parts.push(`Dates written ${mapping.dateFormat}`);
  return parts;
}

/** The title a preview row shows, as the transaction rows do: its description, else its name. */
export function previewRowTitle(row: BankImportLayoutPreviewRow) {
  return row.description || row.counterparty || 'Transaction';
}

/** `Tempo read 03/04/2026 as 3 April 2026`: the date check of a file whose dates read both ways. */
export function dateCheckCopy({written, date}: {written: string; date: string}) {
  const read = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
  return `Tempo read ${written} as ${read}`;
}
