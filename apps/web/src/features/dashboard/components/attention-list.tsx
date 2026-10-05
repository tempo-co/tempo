import {Link} from '@tanstack/react-router';
import {ArrowUpRight} from 'lucide-react';
import {useId} from 'react';

import {Card} from '@/components/ui/card';
import {BANK_TRANSACTION_CATEGORY_LABELS} from '@/features/banking/types/bank-transaction';
import {CASH_FLOW_LABELS, CATEGORY_STATUS_LABELS} from '@/features/banking/utils/drill-filters';

import type {BankTransactionReviewCounts} from '../types/bank-transaction-summary';
import {reviewDrills} from '../utils/drill-links';

type AttentionListProps = {
  reviewCounts: BankTransactionReviewCounts;
  baseCurrency: string | null;
};

/** All-time review groups can overlap, so their counts must not be added together. */
export function AttentionList({reviewCounts, baseCurrency}: AttentionListProps) {
  const headingId = useId();
  const groups: {key: keyof BankTransactionReviewCounts; label: string}[] = [
    {key: 'needsReview', label: BANK_TRANSACTION_CATEGORY_LABELS.NEEDS_REVIEW},
    {key: 'categorizationFailed', label: CATEGORY_STATUS_LABELS.FAILED},
    {key: 'categorizing', label: CATEGORY_STATUS_LABELS.CATEGORIZING},
    {key: 'unknownDirection', label: CASH_FLOW_LABELS.UNKNOWN},
    {key: 'missingBaseAmount', label: `No ${baseCurrency ?? 'base-currency'} amount yet`},
  ];
  const visibleGroups = groups.filter(({key}) => reviewCounts[key] > 0);
  if (visibleGroups.length === 0) return null;

  return (
    <Card role='region' aria-labelledby={headingId} className='grid min-w-0 gap-4 p-5 sm:p-6'>
      <h2 id={headingId} className='text-base font-semibold'>
        Needs attention
      </h2>
      <ul className='-mx-3 divide-y divide-border/60'>
        {visibleGroups.map(({key, label}) => (
          <li key={key}>
            <Link
              to='/bank-transactions'
              search={reviewDrills[key]}
              className='group flex min-h-14 items-center justify-between gap-3 px-3 py-3 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
            >
              <span className='min-w-0'>
                <span className='block text-sm font-medium group-hover:underline'>{label}</span>
                <span className='block text-xs text-muted-foreground'>
                  {reviewCounts[key]} {reviewCounts[key] === 1 ? 'transaction' : 'transactions'} ·
                  all months
                </span>
              </span>
              <ArrowUpRight aria-hidden='true' className='size-4 shrink-0 text-muted-foreground' />
            </Link>
          </li>
        ))}
      </ul>
      <p className='text-xs text-muted-foreground'>
        A transaction can appear in more than one group.
      </p>
    </Card>
  );
}
