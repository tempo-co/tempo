import {
  type RecurringSeries,
  type RecurringSeriesDirection,
  type RecurringSeriesList,
} from '@tempo/contracts';
import {format} from 'date-fns';
import {ChevronRight, RefreshCw, Repeat} from 'lucide-react';
import {useEffect, useState} from 'react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button, buttonVariants} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {formatMoney, toCents} from '@/features/dashboard/utils/money';
import {cn} from '@/utils/cn';
import {savedDataStatus} from '@/utils/query-status';

import {useGetRecurringSeries} from '../api/use-get-recurring-series';
import {RECURRING_CADENCE_LABELS} from '../types/recurring-series';
import {formatBankTransactionCompactDate} from '../utils/formatters';
import {
  formatAmount,
  formatDue,
  formatMonthlyEquivalent,
  groupByDue,
  isCounted,
  isPast,
} from '../utils/recurring-format';
import {RecurringSeriesDetail} from './recurring-series-detail';
import {SeriesIssue, SeriesTile} from './recurring-series-tile';

/** Bills or income, grouped by when each is next due; a row opens its history and actions. */
export function RecurringSeriesOverview({
  asOf,
  selectedKey,
  onSelect,
}: {
  asOf: string;
  /** The series whose details are open; kept by the caller so it survives navigation. */
  selectedKey: string | null;
  onSelect: (seriesKey: string | null) => void;
}) {
  const query = useGetRecurringSeries(asOf);
  const {isPending, isError} = savedDataStatus(query);
  const [direction, setDirection] = useState<RecurringSeriesDirection>('EXPENSE');
  const lists = query.data;
  const selected = lists
    ? [...lists.expenses.series, ...lists.income.series].find(({key}) => key === selectedKey)
    : undefined;
  // An unlink replaces the open series with its two histories; the list shows them, and an undo
  // that brings the series back does not reopen it.
  useEffect(() => {
    if (lists && selectedKey && !selected) onSelect(null);
  }, [lists, selected, selectedKey, onSelect]);
  // Details restored from the URL return to their own tab.
  const selectedDirection = selected?.direction;
  useEffect(() => {
    if (selectedDirection) setDirection(selectedDirection);
  }, [selectedDirection]);

  if (isPending) return <RecurringSkeleton />;
  if (isError || !query.data) {
    return (
      <EmptyState
        icon={RefreshCw}
        tone='error'
        title='Recurring payments are unavailable right now'
        description='Your transactions are unchanged. Try again in a moment.'
      >
        <Button variant='outline' onClick={() => void query.refetch()}>
          Try again
        </Button>
      </EmptyState>
    );
  }

  const {expenses, income} = query.data;
  if (selected) {
    const list = selected.direction === 'INCOME' ? income : expenses;
    return (
      <RecurringSeriesDetail
        series={selected}
        baseCurrency={list.baseCurrency}
        asOf={asOf}
        onBack={() => onSelect(null)}
      />
    );
  }

  if (expenses.series.length === 0 && income.series.length === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title='No recurring payments found yet'
        description='Tempo looks for payments to the same place on a regular rhythm. Annual subscriptions count after two payments; other patterns need at least three.'
      />
    );
  }

  const data = direction === 'INCOME' ? income : expenses;
  return (
    <div className='grid grid-cols-1 gap-6'>
      <ToggleGroup
        type='single'
        variant='outline'
        size='sm'
        value={direction}
        onValueChange={(next) => {
          if (next === 'EXPENSE' || next === 'INCOME') setDirection(next);
        }}
        aria-label='Show bills or income'
        className='justify-start'
      >
        {(
          [
            ['EXPENSE', 'Bills', expenses],
            ['INCOME', 'Income', income],
          ] as const
        ).map(([value, label, list]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className='min-h-9 px-3 text-xs data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-secondary-foreground max-sm:min-h-11 max-sm:flex-1'
          >
            {label}
            <span className='ml-1.5 font-normal text-muted-foreground'>
              {list.series.filter(isCounted).length}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <DirectionView data={data} direction={direction} asOf={asOf} onOpen={onSelect} />
    </div>
  );
}

function DirectionView({
  data,
  direction,
  asOf,
  onOpen,
}: {
  data: RecurringSeriesList;
  direction: RecurringSeriesDirection;
  asOf: string;
  onOpen: (key: string) => void;
}) {
  const isIncome = direction === 'INCOME';
  const active = data.series.filter(isCounted);
  const ended = data.series.filter((s) => !s.hidden && s.status === 'ENDED');
  const hidden = data.series.filter((s) => s.hidden);

  if (data.series.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        {isIncome ? 'No regular income found yet.' : 'No recurring bills found yet.'}
      </p>
    );
  }

  return (
    <div className='grid grid-cols-1 gap-6'>
      <MonthHeader data={data} isIncome={isIncome} activeCount={active.length} />
      {groupByDue(active, asOf).map((group) => (
        <section key={group.id} aria-label={group.title} className='grid grid-cols-1 gap-2'>
          <h3
            className={cn(
              'text-xs font-medium tracking-wide text-muted-foreground uppercase',
              group.id === 'late' && 'text-warning',
            )}
          >
            {group.title}
          </h3>
          <SeriesList
            series={group.series}
            baseCurrency={data.baseCurrency}
            asOf={asOf}
            onOpen={onOpen}
          />
        </section>
      ))}
      <FoldedSection title='Ended' series={ended} data={data} asOf={asOf} onOpen={onOpen} />
      <FoldedSection title='Hidden' series={hidden} data={data} asOf={asOf} onOpen={onOpen} />
    </div>
  );
}

/** The usual monthly total, with this month's paid and still-due amounts beside it. */
function MonthHeader({
  data,
  isIncome,
  activeCount,
}: {
  data: RecurringSeriesList;
  isIncome: boolean;
  activeCount: number;
}) {
  const currency = data.baseCurrency;
  const month = data.thisMonth;
  const monthName = format(parseCalendarDate(`${month.month}-01`), 'MMMM');
  const paid = toCents(month.paid);
  const remaining = toCents(month.remaining);
  const share = paid + remaining > 0 ? paid / (paid + remaining) : 0;

  const noun = `${isIncome ? 'source' : 'bill'}${activeCount === 1 ? '' : 's'}`;

  return (
    <header className='grid grid-cols-1 gap-3' data-testid='recurring-summary'>
      <div className='flex flex-wrap items-end justify-between gap-x-6 gap-y-3'>
        <div>
          <p
            className={cn(
              'numeric text-3xl leading-none font-semibold tracking-tight',
              isIncome && 'text-success',
            )}
          >
            {isIncome && '+'}
            {formatMoney(data.monthlyTotal, currency)}
          </p>
          <p className='mt-1.5 text-sm text-muted-foreground'>
            a month · {activeCount} {noun}
          </p>
        </div>
        <dl className='grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 text-sm'>
          <dd className='text-right numeric font-medium'>{formatMoney(month.paid, currency)}</dd>
          <dt className='text-muted-foreground'>
            {isIncome ? 'received' : 'paid'} in {monthName}
          </dt>
          <dd className='text-right numeric font-medium'>
            {formatMoney(month.remaining, currency)}
          </dd>
          <dt className='text-muted-foreground'>{isIncome ? 'still to come' : 'still due'}</dt>
        </dl>
      </div>
      {paid + remaining > 0 && (
        <div
          className='h-1.5 overflow-hidden bg-muted'
          role='img'
          aria-label={`${Math.round(share * 100)}% of ${monthName}'s ${isIncome ? 'income received' : 'bills paid'}`}
        >
          <div
            className={cn('h-full', isIncome ? 'bg-success' : 'bg-chart-primary')}
            style={{width: `${share * 100}%`}}
          />
        </div>
      )}
      {data.unconvertedCount > 0 && (
        <p className='text-xs text-muted-foreground'>
          {data.unconvertedCount} not converted yet, left out of the totals.
        </p>
      )}
    </header>
  );
}

function FoldedSection({
  title,
  series,
  data,
  asOf,
  onOpen,
}: {
  title: string;
  series: RecurringSeries[];
  data: RecurringSeriesList;
  asOf: string;
  onOpen: (key: string) => void;
}) {
  if (series.length === 0) return null;
  return (
    <details className='group min-w-0' aria-label={title}>
      <summary
        className={cn(
          buttonVariants({variant: 'ghost', size: 'sm'}),
          '-ml-3 cursor-pointer list-none justify-start text-muted-foreground max-sm:h-11 [&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight aria-hidden className='size-4 transition-transform group-open:rotate-90' />
        {title} ({series.length})
      </summary>
      <div className='mt-2'>
        <SeriesList
          series={series}
          baseCurrency={data.baseCurrency}
          asOf={asOf}
          onOpen={onOpen}
          muted
        />
      </div>
    </details>
  );
}

function SeriesList({
  series,
  baseCurrency,
  asOf,
  onOpen,
  muted = false,
}: {
  series: RecurringSeries[];
  baseCurrency: string | null;
  asOf: string;
  onOpen: (key: string) => void;
  muted?: boolean;
}) {
  return (
    <ul className='divide-y divide-border/60 border bg-card'>
      {series.map((entry) => (
        <li key={entry.key} data-testid={`recurring-series-${entry.key}`}>
          <SeriesRow
            series={entry}
            baseCurrency={baseCurrency}
            asOf={asOf}
            onOpen={onOpen}
            muted={muted}
          />
        </li>
      ))}
    </ul>
  );
}

function SeriesRow({
  series,
  baseCurrency,
  asOf,
  onOpen,
  muted,
}: {
  series: RecurringSeries;
  baseCurrency: string | null;
  asOf: string;
  onOpen: (key: string) => void;
  muted: boolean;
}) {
  const when = isPast(series)
    ? `Last ${formatBankTransactionCompactDate(series.lastDate)}`
    : formatDue(series.nextExpectedDate, asOf);
  const perMonth = formatMonthlyEquivalent(series, baseCurrency);

  return (
    <button
      type='button'
      onClick={() => onOpen(series.key)}
      aria-label={`${series.name}, ${formatAmount(series)}, ${RECURRING_CADENCE_LABELS[series.cadence].toLowerCase()}, ${when}`}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        muted && 'opacity-70',
      )}
    >
      <SeriesTile series={series} />
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium'>{series.name}</span>
        <span className='block truncate text-xs text-muted-foreground'>
          {RECURRING_CADENCE_LABELS[series.cadence]} · {when}
        </span>
      </span>
      <span className='shrink-0 text-right'>
        <span
          className={cn(
            'block numeric text-sm font-medium',
            series.direction === 'INCOME' && 'text-success',
          )}
        >
          {series.direction === 'INCOME' && '+'}
          {formatAmount(series)}
        </span>
        <SeriesIssue series={series} fallback={perMonth} />
      </span>
      <ChevronRight aria-hidden className='-mr-1 size-4 shrink-0 text-muted-foreground/60' />
    </button>
  );
}

function RecurringSkeleton() {
  return (
    <div aria-busy='true' aria-label='Loading recurring payments' className='grid gap-5'>
      <Skeleton className='h-9 w-40' />
      <Skeleton className='h-10 w-48' />
      <Skeleton className='h-1.5' />
      <div className='grid gap-px border'>
        <Skeleton className='h-16' />
        <Skeleton className='h-16' />
        <Skeleton className='h-16' />
      </div>
    </div>
  );
}
