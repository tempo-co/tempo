import {useNavigate} from '@tanstack/react-router';
import {X} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  type BankTransactionFilterKey,
  useBankTransactionFilterLabels,
} from '@/hooks/use-bank-transaction-filter-labels';
import {cn} from '@/utils/cn';

import {useGetBankTransactionReviewCounts} from '../api/use-get-bank-transaction-review-counts';
import type {BankTransactionFilterParams} from '../types/bank-transaction';

/**
 * Every filter in force as one removable chip, wherever it was set (the Filters panel or a link from Home). On phones
 * the row starts with the "To review" toggle, which sits in the toolbar on larger screens.
 */
export function BankTransactionFilterChips({filters}: {filters: BankTransactionFilterParams}) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const toReview = useGetBankTransactionReviewCounts().reviewCounts?.needsAttention ?? 0;
  // The toggle shows its own state, so "To review" never doubles as a chip.
  const chips = useBankTransactionFilterLabels(filters).filter(
    (chip) => chip.key !== 'needsAttention',
  );
  const showToggle = Boolean(filters.needsAttention) || toReview > 0;
  if (chips.length === 0 && !showToggle) return null;
  // With only phone items in it, the row takes no space on larger screens.
  const phoneOnlyRow = chips.every((chip) => chip.phoneOnly);

  const remove = (key: BankTransactionFilterKey) =>
    void navigate({search: (prev) => ({...prev, [key]: undefined})});

  return (
    <ul
      aria-label='Filters in force'
      className={cn('flex flex-wrap items-center gap-2', phoneOnlyRow && 'md:hidden')}
      data-testid='bank-transaction-filter-chips'
    >
      {showToggle && (
        <li className='md:hidden'>
          <BankTransactionReviewToggle filters={filters} />
        </li>
      )}
      {chips.map(({key, label, phoneOnly}) => (
        <li key={key} className={cn(phoneOnly && 'md:hidden')}>
          <Button
            variant='secondary'
            size='sm'
            className='h-10 max-w-72 gap-1.5 font-normal sm:h-8'
            aria-label={`Remove filter: ${label}`}
            onClick={() => remove(key)}
          >
            <span className='truncate'>{label}</span>
            <X aria-hidden='true' />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The rows the nav badge counts, one press away: dashed with the count while off, filled with a remove mark while on.
 * Hidden while nothing needs review and it is off.
 */
export function BankTransactionReviewToggle({
  filters,
  className,
}: {
  filters: BankTransactionFilterParams;
  className?: string;
}) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const toReview = useGetBankTransactionReviewCounts().reviewCounts?.needsAttention ?? 0;
  const on = Boolean(filters.needsAttention);
  if (!on && toReview === 0) return null;
  const set = (value: true | undefined) =>
    void navigate({search: (prev) => ({...prev, needsAttention: value})});

  return on ? (
    <Button
      variant='secondary'
      size='sm'
      className={cn('h-10 gap-1.5 font-normal sm:h-8', className)}
      aria-label='Remove filter: To review'
      onClick={() => set(undefined)}
    >
      To review
      <X aria-hidden='true' />
    </Button>
  ) : (
    <Button
      variant='outline'
      size='sm'
      className={cn('h-10 gap-2 border-dashed font-normal sm:h-8', className)}
      onClick={() => set(true)}
    >
      To review
      <span className='grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-primary px-1 numeric text-[0.6875rem] leading-none font-semibold text-primary-foreground'>
        {toReview > 99 ? '99+' : toReview}
      </span>
    </Button>
  );
}
