import type {BankAccount} from '@tempo/contracts';

import {formatBankingWords} from './formatters';

/** The account's own name when it has one; provider names are often just the holder's name. */
export function accountName(
  account: Pick<BankAccount, 'alias' | 'details' | 'name' | 'cashAccountType'>,
) {
  return (
    account.alias ||
    account.details ||
    account.name ||
    formatAccountType(account.cashAccountType) ||
    'Bank account'
  );
}

export function formatAccountType(value: string | null) {
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (normalized === 'CACC') return 'Current account';
  if (normalized === 'SVGS') return 'Savings';
  if (normalized === 'CARD') return 'Card';
  return formatBankingWords(value);
}
