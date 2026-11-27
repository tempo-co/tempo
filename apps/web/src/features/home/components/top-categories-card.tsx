import {Link} from '@tanstack/react-router';
import type {BankTransactionBreakdownPeriod} from '@tempo/contracts';
import type {ReactNode} from 'react';

import {LoadErrorState} from '@/components/shared/state-message';
import {BANK_TRANSACTION_CATEGORY_META} from '@/features/banking/utils/bank-transaction-category-meta';
import {CategoryName} from '@/features/dashboard/components/category-name';
import {Bone, LoadingLabel, TextBone} from '@/features/dashboard/components/loading';
import {wholeCents} from '@/features/dashboard/utils/format';
import {toCents} from '@/features/dashboard/utils/money';

import {type CardEditing, HomeCard} from './home-card';

/** Categories listed. */
const TOP = 5;

/** Insights over this month: the period every link from Home's month figures keeps. */
const THIS_MONTH = {period: 'month'} as const;

/** This month's biggest spending categories so far, each with a bar on the largest's scale, opening its page. */
export function TopCategoriesCard({
  period,
  currency,
  failure,
  editing,
}: {
  /** This month's spending by category; undefined while it loads. */
  period: BankTransactionBreakdownPeriod | null | undefined;
  currency: string | null;
  failure?: {error: unknown; retry: () => unknown};
  editing?: CardEditing;
}) {
  const card = (children: ReactNode) => (
    <HomeCard
      name='Top categories this month'
      editing={editing}
      link={
        <Link to='/insights' search={THIS_MONTH}>
          Insights
        </Link>
      }
    >
      {children}
    </HomeCard>
  );
  if (period === undefined && failure)
    return card(
      <LoadErrorState
        size='section'
        title="Couldn't load this month's categories"
        error={failure.error}
        onRetry={failure.retry}
      />,
    );
  if (period === undefined)
    return card(
      <div aria-busy='true' className='grid gap-3'>
        {Array.from({length: 3}, (_, index) => (
          <div key={index} className='grid gap-1.5'>
            <p className='text-body'>
              <TextBone className='w-[9em]' />
            </p>
            <Bone className='h-1.5' />
          </div>
        ))}
        <LoadingLabel>Loading this month’s categories</LoadingLabel>
      </div>,
    );

  const parts = (period?.parts ?? [])
    .map((part) => ({key: part.key, cents: toCents(part.amount)}))
    .filter((part) => part.cents > 0)
    .slice(0, TOP);
  // With no spending yet the card stays out of the way, except while customizing.
  if (parts.length === 0 && !editing) return null;
  if (parts.length === 0)
    return card(
      <p className='text-body-small text-muted-foreground'>No spending this month yet.</p>,
    );
  const largest = parts[0].cents;
  return card(
    <ul className='-mx-2 grid grid-cols-1'>
      {parts.map((part) => (
        <li key={part.key}>
          <Link
            to='/insights/categories/$category'
            params={{category: part.key}}
            search={THIS_MONTH}
            className='grid grid-cols-1 gap-1.5 rounded-sm px-2 py-2 hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
          >
            <span className='flex items-center justify-between gap-3 text-body'>
              <CategoryName category={part.key} />
              <span className='numeric whitespace-nowrap'>{wholeCents(part.cents, currency)}</span>
            </span>
            <span aria-hidden='true' className='block h-1.5 rounded-full bg-muted'>
              <span
                className='block h-full rounded-full'
                style={{
                  width: `${Math.max(2, (part.cents / largest) * 100)}%`,
                  backgroundColor:
                    BANK_TRANSACTION_CATEGORY_META[
                      part.key as keyof typeof BANK_TRANSACTION_CATEGORY_META
                    ]?.color ?? 'var(--color-chart-primary)',
                }}
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>,
  );
}
