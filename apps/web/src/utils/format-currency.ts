const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function getCurrencyFormatter(currency: string) {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter;
}

/** True when the amount displays as zero in its currency (-0, -0.004). */
export function amountRoundsToZero(amount: number, currency: string) {
  const digits = getCurrencyFormatter(currency).resolvedOptions().maximumFractionDigits ?? 2;
  return Number(amount.toFixed(digits)) === 0;
}

export function formatCurrency(amount: number, currency: string) {
  return getCurrencyFormatter(currency).format(amount);
}
