import {BANK_TRANSACTION_UNCATEGORIZED, type BankTransactionEvent} from '@tempo/contracts';

import {BANK_TRANSACTION_CATEGORY_META} from '@/features/banking/utils/bank-transaction-category-meta';

import {formatWholeMoney, toCents} from './money';

type CategoryKey = keyof typeof BANK_TRANSACTION_CATEGORY_META;

export function categoryLabel(key: string) {
  if (key === BANK_TRANSACTION_UNCATEGORIZED) return 'Uncategorized';
  return BANK_TRANSACTION_CATEGORY_META[key as CategoryKey]?.label ?? key;
}

/** The category's own colour token, for marks only (never text). */
export function categoryColor(key: string) {
  const meta = BANK_TRANSACTION_CATEGORY_META[key as CategoryKey] as
    (typeof BANK_TRANSACTION_CATEGORY_META)[CategoryKey] | undefined;
  const slug = meta?.colorClassName.match(/text-category-([a-z-]+)/)?.[1];
  return slug ? `var(--color-category-${slug})` : 'hsl(var(--muted-foreground))';
}

/** "+€13,139" / "−€2,100" from cents. */
export function signed(cents: number, currency: string | null) {
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  return `${sign}${formatWholeMoney(Math.abs(cents) / 100, currency)}`;
}

/** "+29%" / "−4%" from a ratio. */
export function signedPct(ratio: number) {
  const value = Math.round(ratio * 100);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`;
}

/** "26%" / "−17%" from a ratio. */
export function pct(ratio: number) {
  const value = Math.round(ratio * 100);
  return `${value < 0 ? '−' : ''}${Math.abs(value)}%`;
}

/** Whole money from cents, or a dash when the amount is unknown. */
export function wholeCents(cents: number | null, currency: string | null) {
  return cents === null ? '—' : formatWholeMoney(cents / 100, currency);
}

/** The event's amount as it moved the balance: "+€3,000" in, "−€1,200" out. */
export function signedEvent(event: BankTransactionEvent, currency: string | null) {
  return signed(toCents(event.amount) * (event.direction === 'INCOME' ? 1 : -1), currency);
}

/** "1.4× a usual month". */
export function eventShare(event: BankTransactionEvent) {
  return `${event.share.toLocaleString('en', {maximumFractionDigits: 1})}× a usual month`;
}
