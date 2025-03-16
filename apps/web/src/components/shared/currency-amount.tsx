import {Transaction} from '@/types/transaction';
import {cn} from '@/utils/cn';

const currencySymbols: {[key: string]: string} = {
  USD: '$',
  EUR: '€',
  GBP: '£',
};

type CurrencyAmountProps = {
  amount: Transaction['amount'];
  currency: Transaction['currency'];
};

export function CurrencyAmount({amount, currency}: CurrencyAmountProps) {
  const symbol = currencySymbols[currency] || currency;
  const formattedAmount = amount < 0 ? `-${symbol}${Math.abs(amount)}` : `${symbol}${amount}`;

  return (
    <span className={cn('whitespace-nowrap font-mono', amount > 0 && 'text-success')}>
      {formattedAmount}
    </span>
  );
}
