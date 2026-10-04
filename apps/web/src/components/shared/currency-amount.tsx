import {cn} from '@/utils/cn';

type CurrencyAmountProps = {
  amount: number;
  currency: string;
};

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string) {
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

export function CurrencyAmount({amount, currency}: CurrencyAmountProps) {
  const formatter = getCurrencyFormatter(currency);
  // Amounts that round to zero (-0, -0.004) would otherwise render as "-€0.00".
  const roundsToZero =
    Number(amount.toFixed(formatter.resolvedOptions().maximumFractionDigits ?? 2)) === 0;
  const formattedAmount = formatter.format(roundsToZero ? 0 : amount);

  return (
    <span
      className={cn('font-mono whitespace-nowrap', !roundsToZero && amount > 0 && 'text-success')}
    >
      {formattedAmount}
    </span>
  );
}
