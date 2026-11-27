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
 * that share a name and currency pair up in order, as the preview lists them in the summary's order.
 */
export function importedAccountIds(
  accounts: readonly BankImportPreviewAccount[],
  summary: Pick<BankImportSummary, 'accounts'>,
): (string | null)[] {
  const taken = new Set<string>();
  return accounts.map((account) => {
    const id = account.id
      ? summary.accounts.some(({id}) => id === account.id)
        ? account.id
        : null
      : (summary.accounts.find(
          ({id, created, name, currency}) =>
            created && !taken.has(id) && name === account.name && currency === account.currency,
        )?.id ?? null);
    if (id) taken.add(id);
    return id;
  });
}
