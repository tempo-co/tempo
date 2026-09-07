import {format, parseISO} from 'date-fns';

import {BankTransactionDirection} from '../types/bank-transaction';

export function formatBankTransactionDate(value: string | null) {
  if (!value) return '—';
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? value : format(date, 'MMM d, yyyy');
}

export function formatBankTransactionType(value: string | null) {
  if (!value) return 'Other';
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatBankTransactionDirection(value: BankTransactionDirection) {
  if (value === BankTransactionDirection.INCOME) return 'Income';
  if (value === BankTransactionDirection.EXPENSE) return 'Expense';
  return 'Unknown direction';
}
