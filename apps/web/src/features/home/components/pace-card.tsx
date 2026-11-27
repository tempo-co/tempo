import {Link} from '@tanstack/react-router';
import type {SpendingPace} from '@tempo/contracts';
import {format} from 'date-fns';
import {Minus, TrendingDown, TrendingUp} from 'lucide-react';
import type {ReactNode} from 'react';

import {LoadErrorState} from '@/components/shared/state-message';
import {Bone, LoadingLabel, TextBone} from '@/features/dashboard/components/loading';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {wholeCents} from '@/features/dashboard/utils/format';
import {toCents} from '@/features/dashboard/utils/money';
import {formatMonth} from '@/features/dashboard/utils/month';
import {cn} from '@/utils/cn';

import {type CardEditing, HomeCard} from './home-card';
import {PaceChart} from './pace-chart';

const shortDay = (date: string) => format(parseCalendarDate(date), 'd MMM');

/** Within this many cents of the usual pace, spending is on it. */
const ON_PACE_CENTS = 100;

/**
 * Spending this month up to the last covered day against the usual pace, with the days after that day hatched, and
 * this month's income. Without two complete months there is no usual pace to compare with.
 */
export function PaceCard({
  month,
  pace,
  failure,
  editing,
}: {
  /** `YYYY-MM` of the local date, known before the read answers. */
  month: string;
  pace: SpendingPace | undefined;
  failure?: {error: unknown; retry: () => unknown};
  editing?: CardEditing;
}) {
  const monthName = formatMonth(month, 'MMMM');
  const card = (children: ReactNode) => (
    <HomeCard
      name='Spending pace'
      title={monthName}
      editing={editing}
      link={
        <Link to='/insights/months/$month' params={{month}} search={{period: 'month'}}>
          Insights
        </Link>
      }
    >
      {children}
    </HomeCard>
  );

  if (!pace && failure)
    return card(
      <LoadErrorState
        size='section'
        title="Couldn't load this month's spending"
        error={failure.error}
        onRetry={failure.retry}
      />,
    );
  if (!pace) return card(<PaceSkeleton />);

  const currency = pace.baseCurrency;
  const spent = toCents(pace.spending);
  const covered = pace.daily.length > 0;
  const upTo = pace.lastCoveredDay && shortDay(pace.lastCoveredDay);
  const usualBy = pace.usual ? toCents(pace.usual.byLastCoveredDay) : null;
  const chartLabel = [
    covered
      ? `Spent ${wholeCents(spent, currency)} in ${monthName} up to ${upTo}`
      : `No data for ${monthName} yet`,
    usualBy !== null && `usually ${wholeCents(usualBy, currency)} by then`,
    pace.usual && `${wholeCents(toCents(pace.usual.month), currency)} in a usual month`,
  ]
    .filter(Boolean)
    .join('; ');

  return card(
    <>
      <div className='grid gap-1'>
        <p className='flex flex-wrap items-baseline gap-x-2'>
          <span data-testid='pace-figure' className='numeric text-3xl font-semibold tracking-tight'>
            {wholeCents(spent, currency)}
          </span>
          <span data-testid='pace-up-to' className='text-body-small text-muted-foreground'>
            {covered
              ? `spent in ${monthName}, up to ${upTo}`
              : upTo
                ? `spent in ${monthName}: your data runs up to ${upTo}`
                : `spent in ${monthName}: no data has come in yet`}
          </span>
        </p>
        <PaceComparison spent={spent} usualBy={usualBy} currency={currency} covered={covered} />
      </div>
      <PaceChart
        daysInMonth={pace.daysInMonth}
        spent={pace.daily.map((day) => toCents(day.cumulative))}
        usual={pace.usual?.daily.map((day) => toCents(day.average)) ?? null}
        label={chartLabel}
      />
      <ChartKey upTo={covered ? upTo : null} usual={pace.usual !== null} />
      <dl className='flex flex-wrap gap-x-5 gap-y-1 text-body-small text-muted-foreground'>
        {pace.usual && upTo && (
          <Fact label={`Usual by ${upTo}`} value={wholeCents(usualBy, currency)} />
        )}
        {pace.usual && (
          <Fact label='Usual month' value={wholeCents(toCents(pace.usual.month), currency)} />
        )}
        <Fact
          label='Income'
          value={`+${wholeCents(toCents(pace.income), currency)}`}
          className='text-success'
        />
      </dl>
    </>,
  );
}

function PaceComparison({
  spent,
  usualBy,
  currency,
  covered,
}: {
  spent: number;
  usualBy: number | null;
  currency: string | null;
  covered: boolean;
}) {
  if (usualBy === null)
    return (
      <p className='text-body-small text-muted-foreground'>
        Your usual pace shows once two full months are in.
      </p>
    );
  if (!covered) return null;
  const difference = spent - usualBy;
  if (Math.abs(difference) < ON_PACE_CENTS)
    return (
      <p className='flex items-center gap-1.5 text-body-small font-medium'>
        <Minus aria-hidden='true' className='size-4' />
        On your usual pace
      </p>
    );
  const under = difference < 0;
  const Icon = under ? TrendingDown : TrendingUp;
  return (
    <p
      data-testid='pace-comparison'
      className={cn(
        'flex items-center gap-1.5 text-body-small font-medium',
        under && 'text-success',
      )}
    >
      <Icon aria-hidden='true' className='size-4 shrink-0' />
      <span className='numeric'>
        {wholeCents(Math.abs(difference), currency)} {under ? 'under' : 'over'} your usual pace
      </span>
    </p>
  );
}

/** What the chart's lines and hatching stand for. */
function ChartKey({upTo, usual}: {upTo: string | null; usual: boolean}) {
  return (
    <ul className='-mt-1 flex flex-wrap gap-x-4 gap-y-1 text-label text-muted-foreground'>
      {upTo && (
        <li className='flex items-center gap-1.5'>
          <span aria-hidden='true' className='h-0.5 w-3.5 bg-chart-primary' />
          This month, up to {upTo}
        </li>
      )}
      {usual && (
        <li className='flex items-center gap-1.5'>
          <span
            aria-hidden='true'
            className='w-3.5 border-t-2 border-dashed border-chart-secondary-edge'
          />
          Your usual month
        </li>
      )}
      <li className='flex items-center gap-1.5'>
        <svg aria-hidden='true' viewBox='0 0 10 10' className='size-2.5'>
          <path d='M0 10 10 0M-3 3 3 -3M7 13 13 7' stroke='var(--color-faint)' strokeWidth='1.5' />
        </svg>
        Not in yet
      </li>
    </ul>
  );
}

function Fact({label, value, className}: {label: string; value: string; className?: string}) {
  return (
    <div className='flex gap-1.5'>
      <dt>{label}</dt>
      <dd className={cn('numeric font-medium text-foreground', className)}>{value}</dd>
    </div>
  );
}

/** The loaded card line for line: figure and label, comparison, chart, key and facts, each wrapping where theirs do. */
function PaceSkeleton() {
  const line = (className: string, widths: string[]) => (
    <p className={cn('flex flex-wrap gap-x-4 gap-y-1', className)}>
      {widths.map((width, index) => (
        <span key={index} className='inline-flex h-[1lh] items-center'>
          <TextBone className={width} />
        </span>
      ))}
    </p>
  );
  return (
    <div aria-busy='true' className='grid gap-3'>
      <div className='grid gap-1'>
        <p className='flex flex-wrap items-baseline gap-x-2'>
          <span className='inline-flex h-[1lh] items-center text-3xl'>
            <TextBone className='w-[3em]' />
          </span>
          <span className='inline-flex h-[1lh] items-center text-body-small'>
            <TextBone className='w-[13em]' />
          </span>
        </p>
        {line('text-body-small', ['w-[13em]'])}
      </div>
      <Bone className='h-40' />
      {line('text-label', ['w-[11em]', 'w-[9em]', 'w-[5em]'])}
      {line('text-body-small gap-x-5', ['w-[10em]', 'w-[8.5em]', 'w-[5em]'])}
      <LoadingLabel>Loading this month’s spending</LoadingLabel>
    </div>
  );
}
