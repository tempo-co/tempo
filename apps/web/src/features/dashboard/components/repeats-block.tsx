import {useNavigate} from '@tanstack/react-router';
import {format} from 'date-fns';
import {AlertTriangle, ChevronRight, Clock} from 'lucide-react';

import {useGetRecurringSeries} from '@/features/banking/api/use-get-recurring-series';
import {useGetRecurringSummary} from '@/features/banking/api/use-get-recurring-summary';
import {SeriesTile} from '@/features/banking/components/recurring-series-tile';
import {
  formatAmount,
  formatRelativeDays,
  isCounted,
} from '@/features/banking/utils/recurring-format';
import {cn} from '@/utils/cn';

import {parseCalendarDate} from '../utils/drill-links';
import {formatWholeMoney, toCents} from '../utils/money';
import {formatMonth} from '../utils/month';
import {TextAction} from './text-action';

/** Four rows at most, so the block stays about as tall as the chart beside it. */
const ROWS = 4;

/**
 * What repeats beside the history: bills and income a month, how far this month's bills are paid, late or
 * higher-than-usual bills, then the next payments. Each row opens its series in the recurring dialog.
 */
export function RepeatsBlock({today, className}: {today: string; className?: string}) {
  const series = useGetRecurringSeries(today).data;
  const {summary} = useGetRecurringSummary(today);
  const navigate = useNavigate({from: '/'});
  if (!summary || !series) return null;
  const currency = summary.baseCurrency;
  const bills = toCents(summary.expenseMonthlyTotal);
  const income = toCents(summary.incomeMonthlyTotal);
  if (bills === 0 && income === 0) return null;
  const open = (key?: string) =>
    void navigate({search: (prev) => ({...prev, recurring: 'open', series: key})});
  const paid = toCents(summary.expenseThisMonth.paid);
  const left = toCents(summary.expenseThisMonth.remaining);
  const monthName = formatMonth(summary.expenseThisMonth.month, 'MMMM');
  const flagged = series.expenses.series
    .filter(
      (item) =>
        isCounted(item) &&
        (item.flags.includes('LATE') || item.flags.includes('HIGHER_THAN_USUAL')),
    )
    .slice(0, ROWS);
  const upcoming = summary.upcoming
    .filter((payment) => !flagged.some((item) => item.key === payment.key))
    .slice(0, Math.max(0, ROWS - flagged.length));
  const row =
    'grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5 text-left text-sm hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

  return (
    <section aria-label='Repeats' className={cn('grid content-start gap-4', className)}>
      <header className='-my-2.5 flex items-center justify-between gap-2'>
        <h2 className='text-card-title'>Repeats</h2>
        <TextAction
          onClick={() => open()}
          aria-label='All recurring payments'
          className='-mr-2 gap-0.5'
        >
          All <ChevronRight aria-hidden='true' />
        </TextAction>
      </header>
      <dl className='grid grid-cols-2 gap-x-4'>
        <div className='min-w-0'>
          <dt className='text-label text-muted-foreground'>Bills a month</dt>
          <dd className='numeric text-lg font-semibold'>
            {formatWholeMoney(bills / 100, currency)}
          </dd>
          {summary.expenseUnconvertedCount > 0 && (
            <dd className='text-xs text-muted-foreground'>
              {summary.expenseUnconvertedCount} not converted yet
            </dd>
          )}
        </div>
        <div className='min-w-0'>
          <dt className='text-label text-muted-foreground'>Income a month</dt>
          <dd className='numeric text-lg font-semibold text-success'>
            {formatWholeMoney(income / 100, currency)}
          </dd>
        </div>
      </dl>
      {paid + left > 0 && (
        <div className='grid gap-1.5'>
          <span aria-hidden='true' className='block h-1.5 bg-muted'>
            <span
              className='block h-full bg-chart-primary'
              style={{width: `${(paid / (paid + left)) * 100}%`}}
            />
          </span>
          <p className='numeric text-xs text-muted-foreground'>
            {left === 0
              ? `All of ${monthName}'s bills paid`
              : `${monthName}: ${formatWholeMoney(paid / 100, currency)} paid · ${formatWholeMoney(left / 100, currency)} to go`}
          </p>
        </div>
      )}
      {flagged.length + upcoming.length > 0 && (
        <ul className='-mx-2 grid'>
          {flagged.map((item) => {
            const late = item.flags.includes('LATE');
            const Icon = late ? Clock : AlertTriangle;
            return (
              <li key={item.key}>
                <button type='button' onClick={() => open(item.key)} className={row}>
                  <Icon aria-hidden='true' className='size-4 text-warning' />
                  <span className='min-w-0'>
                    <span className='block truncate'>{item.name}</span>
                    <span className='block text-xs text-warning'>
                      {late ? 'Not paid yet' : 'Higher than usual'}
                    </span>
                  </span>
                  <span className='numeric'>{formatAmount(item)}</span>
                </button>
              </li>
            );
          })}
          {upcoming.map((payment) => (
            <li key={payment.key}>
              <button type='button' onClick={() => open(payment.key)} className={row}>
                <SeriesTile series={payment} className='size-7' />
                <span className='min-w-0'>
                  <span className='block truncate'>{payment.name}</span>
                  <span className='block text-xs text-muted-foreground'>
                    {format(parseCalendarDate(payment.nextExpectedDate), 'd MMM')} ·{' '}
                    {formatRelativeDays(payment.nextExpectedDate, today)}
                  </span>
                </span>
                <span className={cn('numeric', payment.direction === 'INCOME' && 'text-success')}>
                  {payment.direction === 'INCOME' && '+'}
                  {formatAmount(payment)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
