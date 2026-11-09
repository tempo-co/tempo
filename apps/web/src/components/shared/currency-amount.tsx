import {cn} from '@/utils/cn';
import {amountRoundsToZero, getCurrencyFormatter} from '@/utils/format-currency';

type CurrencyAmountProps = {
  amount: number;
  currency: string;
};

export function CurrencyAmount({amount, currency}: CurrencyAmountProps) {
  const formatter = getCurrencyFormatter(currency);
  // Amounts that round to zero would otherwise render as "-€0.00".
  const roundsToZero = amountRoundsToZero(amount, currency);
  const formattedAmount = formatter.format(roundsToZero ? 0 : amount);

  return (
    <span
      className={cn('numeric whitespace-nowrap', !roundsToZero && amount > 0 && 'text-success')}
    >
      {formattedAmount}
    </span>
  );
}
