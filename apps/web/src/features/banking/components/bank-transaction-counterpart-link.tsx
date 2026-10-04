import {Link} from '@tanstack/react-router';
import {ChevronRight} from 'lucide-react';

import {CurrencyAmount} from '@/components/shared/currency-amount';

import {BankTransactionCounterpart} from '../types/bank-transaction';
import {formatBankTransactionDate, formatCounterpartAccount} from '../utils/formatters';

type BankTransactionCounterpartLinkProps = {
  counterpart: BankTransactionCounterpart;
  testId: string;
};

/** A card for the other leg of a linked transaction, opening its details. */
export function BankTransactionCounterpartLink({
  counterpart,
  testId,
}: BankTransactionCounterpartLinkProps) {
  return (
    <Link
      to='.'
      search={(prev) => ({
        ...prev,
        transactionId: counterpart.id,
      })}
      data-testid={testId}
      className='group mt-2 flex min-h-14 w-full max-w-md items-center gap-3 rounded-md border bg-background px-3 py-2 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset'
    >
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium'>
          {formatCounterpartAccount(counterpart)}
        </span>
        {counterpart.bookingDate ? (
          <span className='block text-xs text-muted-foreground'>
            {formatBankTransactionDate(counterpart.bookingDate)}
          </span>
        ) : null}
      </span>
      <span className='shrink-0 text-sm'>
        <CurrencyAmount amount={Number(counterpart.amount)} currency={counterpart.currency} />
      </span>
      <ChevronRight
        aria-hidden='true'
        className='size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none'
      />
    </Link>
  );
}
