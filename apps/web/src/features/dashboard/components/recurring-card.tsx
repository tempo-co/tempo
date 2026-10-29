import {useNavigate} from '@tanstack/react-router';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetRecurringSummary} from '@/features/banking/api/use-get-recurring-summary';
import {SeriesTile} from '@/features/banking/components/recurring-series-tile';
import type {RecurringSummary} from '@/features/banking/types/recurring-series';
import {formatAmount, formatDue} from '@/features/banking/utils/recurring-format';
import {useLocalDate} from '@/hooks/use-local-date';
import {cn} from '@/utils/cn';

import {formatMoney, toCents} from '../utils/money';

/** Bills and income a month and what is due next; the full list is one tap away. */
export function RecurringCard() {
  const asOf = useLocalDate();
  const {summary, isPending, isError, refetch} = useGetRecurringSummary(asOf);
  const navigate = useNavigate({from: '/'});
  const open = () => void navigate({search: (prev) => ({...prev, recurring: 'open'})});

  if (isPending) return <Skeleton className='h-56' aria-label='Loading recurring payments' />;

  return (
    // One shrinkable column: an implicit grid track grows to a truncated name's full width.
    <Card
      className='grid grid-cols-1 gap-4 p-5 sm:p-6'
      role='region'
      aria-label='Recurring payments'
    >
      {/* The 44px link overhangs the title row so the title and content line up with other cards. */}
      <header className='-my-2.5 flex flex-wrap items-center justify-between gap-x-2'>
        <h2 className='text-card-title'>Recurring</h2>
        <button
          type='button'
          onClick={open}
          className='-mr-3 inline-flex min-h-11 items-center px-3 text-xs text-primary underline-offset-4 hover:bg-accent/50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
          aria-label='See all recurring payments'
        >
          See all
        </button>
      </header>
      {isError || !summary ? (
        <div className='grid justify-items-start gap-3'>
          <p className='text-sm'>Could not load recurring payments.</p>
          <Button variant='outline' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : summary.upcoming.length === 0 && toCents(summary.expenseMonthlyTotal) === 0 ? (
        <p className='text-sm text-muted-foreground'>No recurring payments found yet.</p>
      ) : (
        <>
          <ThisMonth summary={summary} />
          {summary.upcoming.length > 0 && (
            <ul className='-mx-3 -mb-3 divide-y divide-border/60'>
              {summary.upcoming.map((payment) => {
                const due = formatDue(payment.nextExpectedDate, asOf);
                const late = payment.flags.includes('LATE');
                return (
                  <li key={payment.key}>
                    <button
                      type='button'
                      onClick={open}
                      className='flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                    >
                      <SeriesTile series={payment} />
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate'>{payment.name}</span>
                        <span
                          className={cn(
                            'block text-xs text-muted-foreground',
                            late && 'text-warning',
                          )}
                        >
                          {late ? 'Not paid yet' : due}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 numeric',
                          payment.direction === 'INCOME' && 'text-success',
                        )}
                      >
                        {payment.direction === 'INCOME' && '+'}
                        {formatAmount(payment)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

/** Bills and income a month side by side; bills also say what is still due this month. */
function ThisMonth({summary}: {summary: RecurringSummary}) {
  const currency = summary.baseCurrency;
  const month = summary.expenseThisMonth;
  const hasIncome = toCents(summary.incomeMonthlyTotal) > 0;

  return (
    <dl className={cn('grid gap-x-6 gap-y-3', hasIncome && 'grid-cols-2')}>
      <div className='min-w-0'>
        <dt className='text-xs text-muted-foreground'>Monthly bills</dt>
        <dd className='numeric text-xl font-semibold'>
          {formatMoney(summary.expenseMonthlyTotal, currency)}
        </dd>
        {toCents(month.remaining) > 0 && (
          <dd className='text-xs whitespace-nowrap text-muted-foreground'>
            <span className='numeric'>{formatMoney(month.remaining, currency)}</span> due this month
          </dd>
        )}
        {summary.expenseUnconvertedCount > 0 && (
          <dd className='text-xs text-muted-foreground'>
            {summary.expenseUnconvertedCount} not converted yet
          </dd>
        )}
      </div>
      {hasIncome && (
        <div className='min-w-0 text-right'>
          <dt className='text-xs text-muted-foreground'>Monthly income</dt>
          <dd className='numeric text-xl font-semibold text-success'>
            +{formatMoney(summary.incomeMonthlyTotal, currency)}
          </dd>
        </div>
      )}
    </dl>
  );
}
