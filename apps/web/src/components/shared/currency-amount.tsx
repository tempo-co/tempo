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
  const formattedAmount = getCurrencyFormatter(currency).format(amount);

  return (
    <span className={cn('whitespace-nowrap font-mono', amount > 0 && 'text-success')}>
      {formattedAmount}
    </span>
  );
}
