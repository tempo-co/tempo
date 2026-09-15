import {format, parseISO} from 'date-fns';

import {
  BANK_TRANSACTION_CATEGORIES,
  BANK_TRANSACTION_CATEGORY_LABELS,
  BankTransactionCategorizationSource,
  BankTransactionCategorizationStatus,
  BankTransactionCategory,
} from '../types/bank-transaction';

export function formatBankTransactionDate(value: string | null) {
  return formatBankTransactionDateValue(value, 'MMM d, yyyy');
}

export function formatBankTransactionCompactDate(value: string | null) {
  return formatBankTransactionDateValue(value, 'd MMM');
}

function formatBankTransactionDateValue(value: string | null, pattern: string) {
  if (!value) return '—';
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? value : format(date, pattern);
}

export function formatBankTransactionType(value: string | null) {
  if (!value) return 'Other';
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function resolveBankTransactionDisplayTitle(transaction: {
  displayDescription?: string | null;
  description: string | null;
}) {
  return transaction.displayDescription || transaction.description || 'Transaction';
}

export function resolveBankTransactionAccountLabel(transaction: {
  bankAccountAlias: string | null;
  bankAccountName: string | null;
}) {
  return transaction.bankAccountAlias || transaction.bankAccountName || 'Bank account';
}

export function formatBankingWords(value: string) {
  return value
    .toLowerCase()
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function isBankTransactionCategory(value: string): value is BankTransactionCategory {
  return (BANK_TRANSACTION_CATEGORIES as readonly string[]).includes(value);
}

export function formatBankTransactionCategory(value: string | null | undefined) {
  return value && isBankTransactionCategory(value)
    ? BANK_TRANSACTION_CATEGORY_LABELS[value]
    : 'Not categorized';
}

export function formatBankTransactionCategoryStatus(
  value: BankTransactionCategorizationStatus | null | undefined,
) {
  const normalized = value?.toUpperCase();
  if (normalized === 'PENDING' || normalized === 'PROCESSING') return 'Categorizing…';
  if (normalized === 'FAILED') return 'Categorization failed. Choose a category manually.';
  if (normalized === 'COMPLETED') return 'Categorized';
  return 'Not categorized';
}

export function formatBankTransactionCategorySource(
  value: BankTransactionCategorizationSource | null | undefined,
) {
  const normalized = value?.toUpperCase();
  if (normalized === 'AI') return 'Suggested by AI';
  if (normalized === 'MANUAL') return 'Manual';
  return null;
}
