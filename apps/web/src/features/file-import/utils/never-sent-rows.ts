import type {
  BankImportNeverSentKind,
  BankImportNeverSentRow,
  BankImportSummary,
} from '@tempo/contracts';

import {plural} from './import-format';

export type NeverSentGroup = {key: string; label: string; rows: BankImportNeverSentRow[]};

/**
 * What each list of rows the bank never sent says: rows the import left out (`not_in_bank`), which the owner adds,
 * and rows of the import a later sync removed (`removed_by_sync`), which the owner adds back.
 */
export const NEVER_SENT_COPY: Record<
  BankImportNeverSentKind,
  {
    /** The summary's line: `Not added: 4 rows your bank never sent`, or that every one was added. */
    line: (count: number) => string;
    intro: string;
    loading: string;
    add: string;
    adding: string;
    added: string;
    failed: (count: number) => string;
  }
> = {
  not_in_bank: {
    line: (count) =>
      count === 0
        ? 'Added every row your bank never sent'
        : `Not added: ${plural(count, 'row')} your bank never sent`,
    intro:
      "Your bank sent every transaction for these days, and these weren't among them. Add any you know are real.",
    loading: 'Loading the rows your bank never sent',
    add: 'Add',
    adding: 'Adding…',
    added: 'Added',
    failed: (count) =>
      count === 1 ? "Couldn't add the transaction" : `Couldn't add ${plural(count, 'transaction')}`,
  },
  removed_by_sync: {
    line: (count) =>
      count === 0
        ? 'Added back every row your bank never sent'
        : `Removed: ${plural(count, 'row')} your bank never sent`,
    intro:
      "Your bank sent every transaction for these days, and these weren't among them, so Wisp removed the file's copies. Add back any you know are real.",
    loading: 'Loading the removed rows your bank never sent',
    add: 'Add back',
    adding: 'Adding back…',
    added: 'Added back',
    failed: (count) =>
      count === 1
        ? "Couldn't add back the transaction"
        : `Couldn't add back ${plural(count, 'transaction')}`,
  },
};

/** How many of the import's rows of this kind are still listed. */
export function neverSentCount(summary: BankImportSummary, kind: BankImportNeverSentKind) {
  return kind === 'not_in_bank' ? summary.rowsNotInBank : summary.rowsRemovedBySync;
}

const groupLabel = ({row}: BankImportNeverSentRow) =>
  row.counterpartyName?.trim() ||
  row.description?.trim() ||
  row.remittanceInformation?.trim() ||
  'No description';

/** What a row of a group says beside the group's name: its description when the group goes by counterparty. */
export function neverSentRowTitle(row: BankImportNeverSentRow) {
  return (
    row.row.description?.trim() ||
    row.row.remittanceInformation?.trim() ||
    row.row.counterpartyName?.trim() ||
    'Transaction'
  );
}

/**
 * The rows by counterparty, else description, compared without case or spacing, so a kind of payment the bank leaves
 * out is one group. Largest group first, then by name; rows in booking order as the API lists them.
 */
export function neverSentGroups(rows: readonly BankImportNeverSentRow[]): NeverSentGroup[] {
  const groups = new Map<string, NeverSentGroup>();
  for (const row of rows) {
    const label = groupLabel(row);
    const key = label.toLocaleLowerCase().replace(/\s+/g, ' ');
    const group = groups.get(key) ?? {key, label, rows: []};
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (left, right) => right.rows.length - left.rows.length || left.label.localeCompare(right.label),
  );
}
