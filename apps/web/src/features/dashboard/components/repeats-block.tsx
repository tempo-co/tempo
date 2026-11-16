import {useNavigate} from '@tanstack/react-router';
import {format} from 'date-fns';
import {ChevronRight} from 'lucide-react';

import {LoadErrorState} from '@/components/shared/state-message';
import {TextAction} from '@/components/shared/text-action';
import {useGetRecurringSummary} from '@/features/banking/api/use-get-recurring-summary';
import {SeriesTile} from '@/features/banking/components/recurring-series-tile';
import {formatAmount, formatRelativeDays} from '@/features/banking/utils/recurring-format';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';
import {cn} from '@/utils/cn';

import {parseCalendarDate} from '../utils/drill-links';
import {wholeCents} from '../utils/format';
import {toCents} from '../utils/money';
import {formatMonth} from '../utils/month';
import {Bone, LoadingLabel, TextBone} from './loading';

/** Four rows at most, so the block stays about as tall as the chart beside it. */
const ROWS = 4;

/**
 * Beside the chart the block always takes the room of its tallest usual shape: the totals, this month's bar and
 * four rows. The chart grows to the side column's height, so a block that loads, shrinks or turns out empty
 * leaves the chart where it was. Under the chart, on narrower screens, it is the card's last part and takes only
 * what it shows. 349px is that shape's height with its top border and padding: four 48px rows, the bar, the
 * totals and the header.
 */
const RESERVE = '@[60rem]:min-h-[21.8125rem]';

const ROW =
  'grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5 text-left text-sm';

/**
 * What repeats beside the history: bills and income a month, how far this month's bills are paid, late or
 * higher-than-usual bills, then the next payments. Each row opens its series in the recurring dialog.
 */
export function RepeatsBlock({today, className}: {today: string; className?: string}) {
  const totals = useGetRecurringSummary(today);
  // Totals in another currency than the reporting one, or none while it is converted, wait for their refetch.
  const accepted = useFiguresCurrencyAccepted();
  const summary = accepted(totals.summary?.baseCurrency) ? totals.summary : undefined;
  const navigate = useNavigate({from: '/'});
  const open = (key?: string) =>
    void navigate({search: (prev) => ({...prev, recurring: 'open', series: key})});
  const header = (
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
  );
  // Nothing to show: beside the chart the room stays, so the chart keeps its height.
  const absent = <div aria-hidden='true' className={cn('@max-[60rem]:hidden', RESERVE)} />;
  // A failed refresh keeps what was loaded; only a read that never loaded says so.
  if (!summary && totals.isError)
    return (
      <section aria-label='Repeats' className={cn('grid content-start gap-4', RESERVE, className)}>
        {header}
        <LoadErrorState
          size='section'
          title="Couldn't load what repeats"
          error={totals.error}
          onRetry={() => totals.refetch()}
        />
      </section>
    );
  if (!summary)
    return (
      <section
        aria-label='Repeats'
        aria-busy='true'
        className={cn('grid content-start gap-4', RESERVE, className)}
      >
        {header}
        <dl className='grid grid-cols-2 gap-x-4'>
          {['Bills a month', 'Income a month'].map((label) => (
            <div key={label} className='min-w-0'>
              <dt className='text-label text-muted-foreground'>{label}</dt>
              <dd className='numeric text-lg font-semibold'>
                <TextBone className='w-[4em]' />
              </dd>
            </div>
          ))}
        </dl>
        <div className='grid gap-1.5'>
          <Bone className='h-1.5' />
          <p className='numeric text-xs'>
            <TextBone className='w-[16em]' />
          </p>
        </div>
        <ul aria-hidden='true' className='-mx-2 grid'>
          {Array.from({length: ROWS}, (_, index) => (
            <li key={index} className={ROW}>
              <Bone className='size-7' />
              <span className='min-w-0'>
                <span className='block'>
                  <TextBone className='w-[8em]' />
                </span>
                <span className='block text-xs'>
                  <TextBone className='w-[9em]' />
                </span>
              </span>
              <span className='numeric'>
                <TextBone className='w-[3.5em]' />
              </span>
            </li>
          ))}
        </ul>
        {/* Last, so each part above is where its loaded self will be. */}
        <LoadingLabel>Loading what repeats</LoadingLabel>
      </section>
    );
  const currency = summary.baseCurrency;
  const bills = toCents(summary.expenseMonthlyTotal);
  const income = toCents(summary.incomeMonthlyTotal);
  if (bills === 0 && income === 0) return absent;
  const paid = toCents(summary.expenseThisMonth.paid);
  const left = toCents(summary.expenseThisMonth.remaining);
  const monthName = formatMonth(summary.expenseThisMonth.month, 'MMMM');
  const flagged = summary.flagged.slice(0, ROWS);
  const upcoming = summary.upcoming
    .filter((payment) => !flagged.some((item) => item.key === payment.key))
    .slice(0, Math.max(0, ROWS - flagged.length));
  const row = cn(
    ROW,
    'hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
  );

  return (
    <section aria-label='Repeats' className={cn('grid content-start gap-4', RESERVE, className)}>
      {header}
      <dl className='grid grid-cols-2 gap-x-4'>
        <div className='min-w-0'>
          <dt className='text-label text-muted-foreground'>Bills a month</dt>
          <dd className='numeric text-lg font-semibold'>{wholeCents(bills, currency)}</dd>
          {summary.expenseUnconvertedCount > 0 && (
            <dd className='text-xs text-muted-foreground'>
              {summary.expenseUnconvertedCount} not converted yet
            </dd>
          )}
        </div>
        <div className='min-w-0'>
          <dt className='text-label text-muted-foreground'>Income a month</dt>
          <dd className='numeric text-lg font-semibold text-success'>
            {wholeCents(income, currency)}
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
              : `${monthName}: ${wholeCents(paid, currency)} paid · ${wholeCents(left, currency)} to go`}
          </p>
        </div>
      )}
      {flagged.length + upcoming.length > 0 && (
        <ul className='-mx-2 grid'>
          {/* The same tile as the payments below, so names line up; the warning line says what's wrong. */}
          {flagged.map((item) => (
            <li key={item.key}>
              <button type='button' onClick={() => open(item.key)} className={row}>
                <SeriesTile series={item} className='size-7' />
                <span className='min-w-0'>
                  <span className='block truncate'>{item.name}</span>
                  <span className='block text-xs text-warning'>
                    {item.flags.includes('LATE') ? 'Not paid yet' : 'Higher than usual'}
                  </span>
                </span>
                <span className='numeric'>{formatAmount(item)}</span>
              </button>
            </li>
          ))}
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
