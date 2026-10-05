import {formatCurrency} from '@/utils/format-currency';

const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(key: string, options: Intl.NumberFormatOptions) {
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, options);
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Integer cents of a two-decimal API amount. The API sums in Postgres, so the browser only
 * compares and formats; rounding removes the binary float error of the decimal string.
 */
export function toCents(value: string) {
  return Math.round(Number(value) * 100);
}

/** A base-currency amount; without a base currency yet the number shows without a symbol. */
export function formatMoney(value: string | number, currency: string | null) {
  const amount = typeof value === 'number' ? value : Number(value);
  return currency
    ? formatCurrency(amount, currency)
    : getFormatter('plain', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(amount);
}

export function formatWholeNumber(value: number) {
  return getFormatter('whole', {maximumFractionDigits: 0}).format(value);
}
