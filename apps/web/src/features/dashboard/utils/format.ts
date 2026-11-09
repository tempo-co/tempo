import {BANK_TRANSACTION_UNCATEGORIZED} from '@tempo/contracts';

import {BANK_TRANSACTION_CATEGORY_META} from '@/features/banking/utils/bank-transaction-category-meta';

import {formatWholeMoney} from './money';

type CategoryKey = keyof typeof BANK_TRANSACTION_CATEGORY_META;

export function categoryLabel(key: string) {
  if (key === BANK_TRANSACTION_UNCATEGORIZED) return 'Uncategorized';
  return BANK_TRANSACTION_CATEGORY_META[key as CategoryKey]?.label ?? key;
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

/**
 * The rem a character of a `text-sm` figure takes, rounded up from about 0.46rem so there is some to spare. A table
 * whose figures can be semibold uses {@link BOLD_FIGURE_CHAR}.
 */
export const FIGURE_CHAR = 0.5;
export const BOLD_FIGURE_CHAR = 0.55;

/**
 * A column width, in rem, that fits the longest of `texts` at `perChar` rem a character, plus `padding` rem, rounded up
 * to a quarter rem and at least `min` rem.
 */
export function figureColumnWidth(
  texts: string[],
  {perChar, padding, min = 0}: {perChar: number; padding: number; min?: number},
) {
  const longest = Math.max(0, ...texts.map((text) => text.length));
  return `${Math.max(min, Math.ceil((longest * perChar + padding) * 4) / 4)}rem`;
}

/** Whole money from cents, or a dash when the amount is unknown. */
export function wholeCents(cents: number | null, currency: string | null) {
  return cents === null ? '—' : formatWholeMoney(cents / 100, currency);
}
