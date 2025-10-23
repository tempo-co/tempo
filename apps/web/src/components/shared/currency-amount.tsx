import {cn} from '@/utils/cn';

type CurrencyAmountProps = {
  amount: number;
  currency: string;
};

export function CurrencyAmount({amount, currency}: CurrencyAmountProps) {
  const formattedAmount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency,
    currencyDisplay: 'symbol',
  }).format(amount);

  return (
    <span className={cn('whitespace-nowrap font-mono', amount > 0 && 'text-success')}>
      {formattedAmount}
    </span>
  );
}
