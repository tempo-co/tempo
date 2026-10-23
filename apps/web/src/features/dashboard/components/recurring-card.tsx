import {useNavigate} from '@tanstack/react-router';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetRecurringSummary} from '@/features/banking/api/use-get-recurring-summary';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {useLocalDate} from '@/hooks/use-local-date';

import {formatMoney, toCents} from '../utils/money';

/** Recurring bills and income a month, and what is due next; the full list is one tap away. */
export function RecurringCard() {
  const asOf = useLocalDate();
  const {summary, isPending, isError, refetch} = useGetRecurringSummary(asOf);
  const navigate = useNavigate({from: '/'});

  if (isPending) return <Skeleton className='h-48' aria-label='Loading recurring payments' />;

  return (
    <Card className='grid gap-4 p-5 sm:p-6' role='region' aria-label='Recurring payments'>
      {/* The 44px link overhangs the title row so the title and content line up with other cards. */}
      <header className='-my-2.5 flex flex-wrap items-center justify-between gap-x-2'>
        <h2 className='text-card-title'>Recurring</h2>
        <button
          type='button'
          onClick={() => void navigate({search: (prev) => ({...prev, recurring: 'open'})})}
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
          <div className='grid gap-1'>
            <p className='text-sm text-muted-foreground'>
              <span className='numeric text-xl font-semibold text-foreground'>
                {formatMoney(summary.expenseMonthlyTotal, summary.baseCurrency)}
              </span>{' '}
              a month in bills
              {summary.expenseUnconvertedCount > 0 &&
                `, excluding ${summary.expenseUnconvertedCount} not converted yet`}
            </p>
            {toCents(summary.incomeMonthlyTotal) > 0 && (
              <p className='text-sm text-muted-foreground'>
                <span className='numeric font-medium text-foreground'>
                  {formatMoney(summary.incomeMonthlyTotal, summary.baseCurrency)}
                </span>{' '}
                a month in income
              </p>
            )}
          </div>
          {summary.upcoming.length > 0 && (
            <div className='grid gap-2'>
              <h3 className='text-xs font-medium text-muted-foreground'>Next up</h3>
              <ul className='grid gap-2'>
                {summary.upcoming.map((payment) => (
                  <li key={payment.key} className='flex items-baseline gap-3 text-sm'>
                    <span className='w-14 shrink-0 text-muted-foreground'>
                      {formatBankTransactionCompactDate(payment.nextExpectedDate)}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>{payment.name}</span>
                    <span className='shrink-0 numeric'>
                      {payment.amountKind === 'VARIABLE' && '≈ '}
                      {payment.direction === 'INCOME' && '+'}
                      {formatMoney(payment.typicalAmount, payment.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
