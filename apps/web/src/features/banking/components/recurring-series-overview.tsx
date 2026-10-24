import {Link} from '@tanstack/react-router';
import {format} from 'date-fns';
import {ChevronDown, MoreHorizontal, RefreshCw, Repeat} from 'lucide-react';
import {useState} from 'react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Skeleton} from '@/components/ui/skeleton';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {formatMoney} from '@/features/dashboard/utils/money';
import {cn} from '@/utils/cn';
import {savedDataStatus} from '@/utils/query-status';

import {useGetRecurringSeries} from '../api/use-get-recurring-series';
import {useUpdateRecurringSeries} from '../api/use-update-recurring-series';
import {
  RECURRING_CADENCE_LABELS,
  type RecurringSeries,
  type RecurringSeriesDirection,
  type RecurringSeriesList,
} from '../types/recurring-series';
import {formatBankTransactionCompactDate} from '../utils/formatters';

type Groups = Record<'active' | 'ended' | 'hidden', RecurringSeries[]>;

function groupSeries(series: RecurringSeries[]): Groups {
  const groups: Groups = {active: [], ended: [], hidden: []};
  for (const entry of series) {
    if (entry.hidden) groups.hidden.push(entry);
    else if (entry.status === 'ENDED') groups.ended.push(entry);
    else groups.active.push(entry);
  }
  return groups;
}

/** "+€2.20 since Aug" or "−€3.50 since Jan", against the price before the change. */
function formatPriceChange({amount, since}: {amount: string; since: string}, currency: string) {
  const value = Number(amount);
  const sign = value < 0 ? '−' : '+';
  return `${sign}${formatMoney(Math.abs(value), currency)} since ${format(parseCalendarDate(since), 'MMM')}`;
}

/** Every recurring payment Tempo found counts; a wrong one can be hidden and restored. */
export function RecurringSeriesOverview({asOf}: {asOf: string}) {
  const query = useGetRecurringSeries(asOf);
  const {isPending, isError} = savedDataStatus(query);
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

  return (
    <div className='grid gap-6'>
      <DirectionSection direction='EXPENSE' data={query.data.expenses} />
      <DirectionSection direction='INCOME' data={query.data.income} />
    </div>
  );
}

/** Bills and income share grouping and folds, but keep their own headings and empty states. */
function DirectionSection({
  direction,
  data,
}: {
  direction: RecurringSeriesDirection;
  data: RecurringSeriesList;
}) {
  const isIncome = direction === 'INCOME';
  if (data.series.length === 0) {
    return isIncome ? null : (
      <EmptyState
        icon={Repeat}
        title='No recurring payments found yet'
        description='Tempo looks for payments to the same place on a regular rhythm, leaving out ordinary grocery and shopping patterns. Annual subscriptions count after two payments; other patterns need at least three.'
      />
    );
  }

  const groups = groupSeries(data.series);
  const content = (
    <>
      {isIncome ? (
        <>
          <header>
            <h2 className='text-section-title'>
              Income{' '}
              <span className='text-sm font-normal text-muted-foreground'>
                {groups.active.length}
              </span>
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              <span className='numeric font-semibold text-foreground'>
                {formatMoney(data.monthlyTotal, data.baseCurrency)}
              </span>{' '}
              a month
            </p>
          </header>
          {groups.active.length > 0 && (
            <SeriesList series={groups.active} baseCurrency={data.baseCurrency} />
          )}
        </>
      ) : (
        <>
          <p className='text-sm text-muted-foreground' data-testid='recurring-summary'>
            <span className='numeric font-semibold text-foreground'>
              {formatMoney(data.monthlyTotal, data.baseCurrency)}
            </span>{' '}
            a month across {groups.active.length}{' '}
            {groups.active.length === 1 ? 'payment' : 'payments'}
            {data.unconvertedCount > 0 && `, excluding ${data.unconvertedCount} not converted yet`}.
          </p>
          <SeriesSection title='Bills' series={groups.active} baseCurrency={data.baseCurrency} />
        </>
      )}
      <FoldedSection
        title={isIncome ? 'Ended income' : 'Ended'}
        series={groups.ended}
        baseCurrency={data.baseCurrency}
      />
      <FoldedSection
        title={isIncome ? 'Hidden income' : 'Hidden'}
        series={groups.hidden}
        baseCurrency={data.baseCurrency}
      />
    </>
  );

  return isIncome ? (
    <section aria-label='Income' className='grid gap-3 border-t pt-6'>
      {content}
    </section>
  ) : (
    content
  );
}

function SeriesSection({
  title,
  series,
  baseCurrency,
}: {
  title: string;
  series: RecurringSeries[];
  baseCurrency: string | null;
}) {
  if (series.length === 0) return null;
  return (
    <section aria-label={title} className='grid gap-3'>
      <h2 className='text-section-title'>
        {title} <span className='text-sm font-normal text-muted-foreground'>{series.length}</span>
      </h2>
      <SeriesList series={series} baseCurrency={baseCurrency} />
    </section>
  );
}

function FoldedSection({
  title,
  series,
  baseCurrency,
}: {
  title: string;
  series: RecurringSeries[];
  baseCurrency: string | null;
}) {
  if (series.length === 0) return null;
  return (
    <details className='group' aria-label={title}>
      <summary className='flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'>
        {title} ({series.length})
      </summary>
      <div className='mt-3'>
        <SeriesList series={series} baseCurrency={baseCurrency} />
      </div>
    </details>
  );
}

function SeriesList({
  series,
  baseCurrency,
}: {
  series: RecurringSeries[];
  baseCurrency: string | null;
}) {
  return (
    <Card className='overflow-hidden p-0'>
      <ul className='divide-y divide-border/60'>
        {series.map((entry) => (
          <SeriesRow key={entry.key} series={entry} baseCurrency={baseCurrency} />
        ))}
      </ul>
    </Card>
  );
}

function SeriesRow({series, baseCurrency}: {series: RecurringSeries; baseCurrency: string | null}) {
  const {update, isPending: busy} = useUpdateRecurringSeries();
  const showMonthly =
    series.monthlyEquivalent !== null &&
    (series.cadence !== 'MONTHLY' || series.currency !== baseCurrency);
  const {continuation} = series;

  return (
    <li
      className='flex items-start gap-2 px-4 py-3'
      data-testid={`recurring-series-${series.key}`}
      aria-busy={busy || undefined}
    >
      <div className='min-w-0 flex-1'>
        <div className='flex items-baseline justify-between gap-3'>
          <Link
            to='/bank-transactions'
            search={{recurringSeriesKey: series.key}}
            className='min-w-0 font-medium break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
            aria-label={`${series.name}, ${series.transactionCount} payments`}
          >
            {series.name}
          </Link>
          <p className='shrink-0 text-right text-sm'>
            <span className='numeric'>
              {series.amountRange && '≈ '}
              {formatMoney(series.typicalAmount, series.currency)}
            </span>
            {series.amountRange && (
              <span className='block numeric text-xs text-muted-foreground'>
                {formatMoney(series.amountRange.low, series.currency)} –{' '}
                {formatMoney(series.amountRange.high, series.currency)}
              </span>
            )}
          </p>
        </div>
        <p className='mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
          <span>{RECURRING_CADENCE_LABELS[series.cadence]}</span>
          {showMonthly && (
            <span>
              ≈{' '}
              <span className='numeric'>
                {formatMoney(series.monthlyEquivalent!, baseCurrency)}
              </span>{' '}
              a month
            </span>
          )}
          <span>
            {series.status === 'ENDED'
              ? `Last paid ${formatBankTransactionCompactDate(series.lastDate)}`
              : `Next around ${formatBankTransactionCompactDate(series.nextExpectedDate)}`}
          </span>
          {series.flags.includes('LATE') && <Badge variant='secondary'>Late</Badge>}
          {series.flags.includes('HIGHER_THAN_USUAL') && (
            <Badge variant='outline' className='border-warning/60 text-warning'>
              Higher than usual
            </Badge>
          )}
          {series.priceChange && (
            <Badge variant='secondary' className='numeric'>
              {formatPriceChange(series.priceChange, series.currency)}
            </Badge>
          )}
        </p>
        {series.recentPayments.length > 0 && <RecentPayments series={series} />}
        {continuation && (
          <p className='mt-1 text-xs text-muted-foreground'>
            {continuation.linked
              ? `Includes earlier payments to ${continuation.previousName}.`
              : `Kept apart from ${continuation.previousName}.`}
          </p>
        )}
      </div>
      {series.hidden ? (
        <Button
          size='sm'
          variant='ghost'
          className='-my-1 max-sm:h-11'
          disabled={busy}
          onClick={() => void update({kind: 'hidden', key: series.key, hidden: false})}
          aria-label={`Show ${series.name} again`}
        >
          Show again
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size='icon'
              variant='ghost'
              className='-my-1 -mr-2 size-11 shrink-0 sm:size-8'
              disabled={busy}
              aria-label={`More for ${series.name}`}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onSelect={() => void update({kind: 'hidden', key: series.key, hidden: true})}
            >
              Not recurring
            </DropdownMenuItem>
            {continuation && (
              <DropdownMenuItem
                onSelect={() =>
                  void update({
                    kind: 'linked',
                    key: series.key,
                    linked: !continuation.linked,
                    previousName: continuation.previousName,
                  })
                }
              >
                {continuation.linked
                  ? `Unlink ${continuation.previousName}`
                  : `Link with ${continuation.previousName}`}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/** A variable amount's recent payments, newest first, folded away until asked for. */
function RecentPayments({series}: {series: RecurringSeries}) {
  const [open, setOpen] = useState(false);
  return (
    <div className='mt-1'>
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className='-mx-1 inline-flex min-h-8 items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:min-h-11'
      >
        Recent payments
        <ChevronDown
          aria-hidden
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul
          aria-label={`Recent payments to ${series.name}`}
          className='mt-1 grid max-w-xs gap-0.5 text-xs'
        >
          {[...series.recentPayments].reverse().map((payment, index) => {
            const unusual = index === 0 && series.flags.includes('HIGHER_THAN_USUAL');
            return (
              <li
                key={`${payment.date}-${index}`}
                data-unusual={unusual || undefined}
                className={cn('flex justify-between gap-4', unusual && 'font-medium text-warning')}
              >
                <span className='text-muted-foreground'>
                  {formatBankTransactionCompactDate(payment.date)}
                </span>
                <span className='numeric'>{formatMoney(payment.amount, series.currency)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RecurringSkeleton() {
  return (
    <div aria-busy='true' aria-label='Loading recurring payments' className='grid gap-4'>
      <Skeleton className='h-4 w-72' />
      <Skeleton className='h-6 w-32' />
      <Card className='grid gap-3 p-4'>
        <Skeleton className='h-12' />
        <Skeleton className='h-12' />
        <Skeleton className='h-12' />
      </Card>
    </div>
  );
}
