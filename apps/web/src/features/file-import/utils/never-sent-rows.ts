import type {BankImportNeverSentRow} from '@tempo/contracts';

import {plural} from './import-format';

export type NeverSentGroup = {key: string; label: string; rows: BankImportNeverSentRow[]};

/** The summary's line: `4 rows in the file your bank never sent, not added`, or that every one was added. */
export function neverSentLine(count: number) {
  if (count === 0) return 'Every row your bank never sent was added';
  return `${plural(count, 'row')} in the file your bank never sent, not added`;
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
