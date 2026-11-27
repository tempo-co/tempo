import type {BankImportPreviewAccount, BankImportSummary} from '@tempo/contracts';

import {accountName} from '@/features/banking/utils/bank-account-name';

/**
 * The name to save for a found account from what the owner typed, as Accounts' Rename saves it: null to go back to
 * the account's own name (left empty, or typed as it is), undefined when nothing changes.
 */
export function typedAlias(
  account: BankImportPreviewAccount,
  typed: string,
): string | null | undefined {
  const name = typed.trim();
  const next = name === '' || name === accountName({...account, alias: null}) ? null : name;
  return next === account.alias ? undefined : next;
}

/**
 * The account each previewed account became in the import, in the preview's order: a found one by its id, a created
 * one by the name and currency the preview gave it, which the import gives the account it creates. Created accounts
 * that share a name and currency pair up in order, as the preview lists them in the summary's order. When the import
 * created none (a retry after an import whose reply was lost), the account of that name and currency it wrote to is it.
 */
export function importedAccountIds(
  accounts: readonly BankImportPreviewAccount[],
  summary: Pick<BankImportSummary, 'accounts'>,
): (string | null)[] {
  // Accounts the preview found are theirs: a new account's fallback never takes one.
  const taken = new Set<string>(accounts.flatMap(({id}) => (id ? [id] : [])));
  return accounts.map((account) => {
    if (account.id) return summary.accounts.some(({id}) => id === account.id) ? account.id : null;
    const id =
      sameNamed(summary, account, taken, true) ?? sameNamed(summary, account, taken, false);
    if (id) taken.add(id);
    return id;
  });
}

/** The first summary account not yet taken with the previewed account's name and currency, created or found. */
function sameNamed(
  summary: Pick<BankImportSummary, 'accounts'>,
  account: BankImportPreviewAccount,
  taken: ReadonlySet<string>,
  created: boolean,
): string | null {
  return (
    summary.accounts.find(
      (other) =>
        other.created === created &&
        !taken.has(other.id) &&
        other.name === account.name &&
        other.currency === account.currency,
    )?.id ?? null
  );
}
