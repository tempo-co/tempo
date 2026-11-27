import type {BankImportPreviewAccount, BankImportSummary} from '@tempo/contracts';

import {accountName} from '@/features/banking/utils/bank-account-name';

/** The name a found account shows, as Accounts names it: the owner's name for it, else its own. */
export function foundAccountName(account: BankImportPreviewAccount) {
  return accountName(account);
}

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
 * The account a previewed account became in the import: a found one by its id, a created one by the name and
 * currency the preview gave it, which the import gives the account it creates.
 */
export function importedAccountId(
  account: BankImportPreviewAccount,
  summary: Pick<BankImportSummary, 'accounts'>,
): string | null {
  if (account.id) return summary.accounts.some(({id}) => id === account.id) ? account.id : null;
  return (
    summary.accounts.find(
      ({created, name, currency}) =>
        created && name === account.name && currency === account.currency,
    )?.id ?? null
  );
}
