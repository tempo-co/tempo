import {Link} from '@tanstack/react-router';
import type {RecurringSummary} from '@wisp/contracts';
import {format} from 'date-fns';
import type {ReactNode} from 'react';

import {LoadErrorState} from '@/components/shared/state-message';
import {SeriesTile} from '@/features/banking/components/recurring-series-tile';
import {formatAmount, formatRelativeDays} from '@/features/banking/utils/recurring-format';
import {LoadingLabel, TileRowsSkeleton} from '@/features/dashboard/components/loading';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {wholeCents} from '@/features/dashboard/utils/format';
import {toCents} from '@/features/dashboard/utils/money';
import {formatMonth} from '@/features/dashboard/utils/month';
import {cn} from '@/utils/cn';

import {type CardEditing, HomeCard} from './home-card';

/** Payments listed at most: late bills first, then the next ones due. */
const ROWS = 4;

const ROW =
  'grid min-h-15 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

/**
 * The bills that are late and the payments due next, each opening its series on Recurring, and what this month's
 * bills still need.
 */
export function ComingUpCard({
  today,
  summary,
  failure,
  editing,
}: {
  today: string;
  summary: RecurringSummary | undefined;
  failure?: {error: unknown; retry: () => unknown};
  editing?: CardEditing;
}) {
  const card = (children: ReactNode) => (
    <HomeCard name='Coming up' editing={editing} link={<Link to='/recurring'>Recurring</Link>}>
      {children}
    </HomeCard>
  );
  if (!summary && failure)
    return card(
      <LoadErrorState
        size='section'
        title="Couldn't load what's coming up"
        error={failure.error}
        onRetry={failure.retry}
      />,
    );
  if (!summary)
    return card(
      <div aria-busy='true'>
        <ul className='-mx-3 grid'>
          <TileRowsSkeleton count={3} />
        </ul>
        <LoadingLabel>Loading what’s coming up</LoadingLabel>
      </div>,
    );

  const late = summary.flagged.filter((series) => series.flags.includes('LATE')).slice(0, ROWS);
  const next = summary.upcoming
    .filter((payment) => !late.some((series) => series.key === payment.key))
    .slice(0, ROWS - late.length);
  const left = toCents(summary.expenseThisMonth.remaining);
  // With nothing coming up the card stays out of the way, except while customizing.
  if (late.length + next.length === 0 && !editing) return null;
  if (late.length + next.length === 0)
    return card(
      <p className='text-body-small text-muted-foreground'>
        Nothing recurring is due. Bills show here once they’ve repeated a few times.
      </p>,
    );

  return card(
    <>
      <ul className='-mx-3 grid'>
        {late.map((series) => (
          <li key={series.key}>
            <Link to='/recurring' search={{series: series.key}} className={ROW}>
              <SeriesTile series={series} />
              <span className='min-w-0'>
                <span className='block truncate text-body'>{series.name}</span>
                <span className='block text-body-small text-warning'>Not paid yet</span>
              </span>
              <span className='numeric text-body'>{formatAmount(series)}</span>
            </Link>
          </li>
        ))}
        {next.map((payment) => (
          <li key={payment.key}>
            <Link to='/recurring' search={{series: payment.key}} className={ROW}>
              <SeriesTile series={payment} />
              <span className='min-w-0'>
                <span className='block truncate text-body'>{payment.name}</span>
                <span className='block truncate text-body-small text-muted-foreground'>
                  {format(parseCalendarDate(payment.nextExpectedDate), 'd MMM')} ·{' '}
                  {formatRelativeDays(payment.nextExpectedDate, today)}
                </span>
              </span>
              <span
                className={cn(
                  'numeric text-body',
                  payment.direction === 'INCOME' && 'text-success',
                )}
              >
                {payment.direction === 'INCOME' && '+'}
                {formatAmount(payment)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {left > 0 && (
        <p className='text-body-small text-muted-foreground'>
          <span className='numeric font-medium text-foreground'>
            {wholeCents(left, summary.baseCurrency)}
          </span>{' '}
          of bills still due in {formatMonth(summary.expenseThisMonth.month, 'MMMM')}
        </p>
      )}
    </>,
  );
}
