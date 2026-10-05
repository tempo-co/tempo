import {cn} from '@/utils/cn';
import {getCurrencyFormatter} from '@/utils/format-currency';

type CurrencyAmountProps = {
  amount: number;
  currency: string;
};

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
