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

/**
 * What tells the account apart under its name: its type when the name is not already that, and the last four
 * characters of its masked identifier. Empty when neither is known.
 */
export function accountSubline(
  account: Pick<BankAccount, 'alias' | 'details' | 'name' | 'cashAccountType' | 'maskedIdentifier'>,
) {
  const type = formatAccountType(account.cashAccountType);
  const digits = account.maskedIdentifier?.replace(/[^0-9A-Za-z]/g, '').slice(-4);
  return [type !== accountName(account) && type, digits && `••${digits}`]
    .filter(Boolean)
    .join(' · ');
}

export function formatAccountType(value: string | null) {
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (normalized === 'CACC') return 'Current account';
  if (normalized === 'SVGS') return 'Savings';
  if (normalized === 'CARD') return 'Card';
  return formatBankingWords(value);
}
