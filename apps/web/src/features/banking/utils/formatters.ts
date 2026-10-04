import {format, isThisYear, parseISO} from 'date-fns';

import {
  BANK_TRANSACTION_ACTIVITY_LABELS,
  BANK_TRANSACTION_CATEGORIES,
  BANK_TRANSACTION_CATEGORY_LABELS,
  BANK_TRANSACTION_FINANCIAL_EVENT_LABELS,
  BankTransaction,
  BankTransactionCashFlowTreatment,
  BankTransactionCategorizationSource,
  BankTransactionCategorizationStatus,
  BankTransactionCategory,
  BankTransactionFinancialEventType,
  OwnTransferEvidence,
} from '../types/bank-transaction';

export function formatBankTransactionDate(value: string | null) {
  return formatBankTransactionDateValue(value, 'MMM d, yyyy');
}

/** Day and month, with the year only when it is not the current one. */
export function formatBankTransactionCompactDate(value: string | null) {
  return formatBankTransactionDateValue(value, (date) =>
    isThisYear(date) ? 'd MMM' : 'd MMM yyyy',
  );
}

function formatBankTransactionDateValue(
  value: string | null,
  pattern: string | ((date: Date) => string),
) {
  if (!value) return '—';
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, typeof pattern === 'string' ? pattern : pattern(date));
}

export function formatBankTransactionFinancialEvent(
  value: BankTransactionFinancialEventType | null | undefined,
) {
  return value ? BANK_TRANSACTION_FINANCIAL_EVENT_LABELS[value] : null;
}

/** Activity label for the table and details: a financial event, else an own transfer. */
export function formatBankTransactionActivity(transaction: {
  financialEventType: BankTransactionFinancialEventType | null | undefined;
  ownTransfer?: {evidence: OwnTransferEvidence} | null;
}) {
  return (
    formatBankTransactionFinancialEvent(transaction.financialEventType) ??
    (transaction.ownTransfer ? BANK_TRANSACTION_ACTIVITY_LABELS.OWN_TRANSFER : null)
  );
}

export function formatOwnTransferEvidence(value: OwnTransferEvidence) {
  switch (value) {
    case 'IBAN':
      return 'Matched by IBAN';
    case 'NAME':
      return 'Matched by account holder name';
    case 'MANUAL':
      return 'Marked by you';
  }
}

export function formatBankTransactionCashFlowTreatment(
  value: BankTransactionCashFlowTreatment | null | undefined,
) {
  if (value === 'INCOME') return 'Income';
  if (value === 'EXPENSE') return 'Expense';
  if (value === 'INTERNAL') return 'Internal movement';
  return 'Unknown';
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

export function resolveBankAccountLabel(account: {alias: string | null; name: string | null}) {
  return account.alias || account.name || 'Bank account';
}

export function resolveBankTransactionAccountLabel(transaction: {
  bankAccountAlias: string | null;
  bankAccountName: string | null;
}) {
  return resolveBankAccountLabel({
    alias: transaction.bankAccountAlias,
    name: transaction.bankAccountName,
  });
}

/**
 * Names the other leg's account. Provider account names are often the holder's name and repeat across
 * a bank's currency accounts, so the bank and currency identify it unless the owner set an alias.
 */
export function formatOwnTransferCounterpartAccount(counterpart: {
  bankName: string;
  bankAccountAlias: string | null;
  currency: string;
}) {
  return counterpart.bankAccountAlias || `${counterpart.bankName} · ${counterpart.currency}`;
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
  if (normalized === 'NOT_APPLICABLE') return 'Category not applicable';
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

/**
 * The muted line under a transaction's category. Regular transactions only get one for manual
 * categories or while categorization is pending, failed or not applicable.
 */
export function formatBankTransactionCategorySubtitle(transaction: BankTransaction) {
  const source = formatBankTransactionCategorySource(transaction.categorySource);
  const isManual = transaction.categorySource === 'MANUAL';

  const isExchange = Boolean(formatBankTransactionFinancialEvent(transaction.financialEventType));
  if (isExchange || transaction.ownTransfer) {
    // Exchanges and own transfers keep no counted category, so only the treatment shows; an own
    // transfer's manual category does not count either.
    const cashFlowTreatment = formatBankTransactionCashFlowTreatment(transaction.cashFlowTreatment);
    if (
      isExchange &&
      isManual &&
      transaction.category &&
      isBankTransactionCategory(transaction.category)
    ) {
      const category = `Category: ${formatBankTransactionCategory(transaction.category)}`;
      return [category, source, cashFlowTreatment].join(' · ');
    }
    return cashFlowTreatment;
  }

  if (isManual) return source;
  if (transaction.categoryStatus === 'COMPLETED') return null;
  return formatBankTransactionCategoryStatus(transaction.categoryStatus);
}
