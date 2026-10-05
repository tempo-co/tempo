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

export function formatCurrency(amount: number, currency: string) {
  return getCurrencyFormatter(currency).format(amount);
}
