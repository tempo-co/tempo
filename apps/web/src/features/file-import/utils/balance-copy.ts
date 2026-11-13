import type {BankAccount} from '@tempo/contracts';

import {HttpError} from '@/utils/api';

import {AccountGoneError} from '../api/use-set-account-balance';

export const ADD_BALANCE = 'Add balance';
export const BALANCE_HELP = 'Tempo works out earlier balances from your transactions.';

export function balanceLabel(accountName: string) {
  return `Balance of ${accountName} today`;
}

type BalanceCopy = {title: string; description: string};

export type BalanceAction = 'add' | 'edit' | null;

/**
 * What an imported-files account's card offers for its balance: Add balance without one, Edit for one the owner
 * entered, nothing for one its statements state.
 */
export function balanceActionOf(
  account: Pick<BankAccount, 'currentBalanceAmount' | 'balanceSource'>,
): BalanceAction {
  if (account.currentBalanceAmount === null) return 'add';
  return account.balanceSource === 'stated' ? 'edit' : null;
}

/** Shown under the field, before anything is sent. */
export const INVALID_BALANCE: BalanceCopy = {
  title: 'Enter an amount',
  description: 'Use digits with at most two decimals, such as 1250.00 or -40.50.',
};

/**
 * A typed balance as the API takes it (`-1234.56`), or null when it is not one: an optional minus, digits, and at
 * most two decimals after a point or a comma. Spaces are ignored; thousands separators are not read.
 */
export function parseBalanceAmount(text: string): string | null {
  const [, sign, whole, fraction] =
    /^([-−]?)(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(text.replace(/\s/g, '')) ?? [];
  if (whole === undefined) return null;
  return `${sign ? '-' : ''}${whole}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** What a refused or failed save means for the owner; the API's balance refusals are its typed codes. */
export function describeBalanceFailure(error: unknown): BalanceCopy {
  if (error instanceof AccountGoneError || (error instanceof HttpError && error.status === 404))
    return {
      title: 'This account is no longer here',
      description: 'It was removed, for example by undoing its import.',
    };
  if (error instanceof HttpError && error.code === 'balance_from_bank')
    return {
      title: "This account's balance comes from its bank",
      description: 'It updates with every sync.',
    };
  if (error instanceof HttpError && error.status === 400) return INVALID_BALANCE;
  return {title: "Couldn't save the balance", description: 'Please try again in a moment.'};
}
