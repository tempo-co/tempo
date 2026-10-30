import {Link} from '@tanstack/react-router';
import {format} from 'date-fns';
import {ArrowLeft, ArrowUpRight, Eye, EyeOff, Link2, Link2Off} from 'lucide-react';
import {Bar, BarChart, Cell, XAxis} from 'recharts';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {ChartContainer, ChartTooltip} from '@/components/ui/chart';
import {Skeleton} from '@/components/ui/skeleton';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {formatMoney, formatWholeMoney} from '@/features/dashboard/utils/money';
import {cn} from '@/utils/cn';

import {useGetRecurringPayments} from '../api/use-get-recurring-payments';
import {useUpdateRecurringSeries} from '../api/use-update-recurring-series';
import type {BankTransaction} from '../types/bank-transaction';
import {RECURRING_CADENCE_LABELS, type RecurringSeries} from '../types/recurring-series';
import {formatBankTransactionCompactDate} from '../utils/formatters';
import {
  formatAmount,
  formatMonthlyEquivalent,
  formatPriceChange,
  formatRelativeDays,
  isPast,
} from '../utils/recurring-format';
import {SeriesTile} from './recurring-series-tile';
import {TransactionListRow} from './transaction-list-row';

/** One series: its payment history, what to expect next, and every correction in one place. */
export function RecurringSeriesDetail({
  series,
  baseCurrency,
  asOf,
  onBack,
}: {
  series: RecurringSeries;
  baseCurrency: string | null;
  asOf: string;
  onBack: () => void;
}) {
  const {update, isPending: busy} = useUpdateRecurringSeries();
  const {continuation} = series;
  const isIncome = series.direction === 'INCOME';
  const monthly = formatMonthlyEquivalent(series, baseCurrency);
  const yearly = series.monthlyEquivalent !== null ? Number(series.monthlyEquivalent) * 12 : null;

  return (
    <section
      aria-label='Recurring payment details'
      className='grid grid-cols-1 gap-6'
      aria-busy={busy || undefined}
    >
      <Button
        variant='ghost'
        size='sm'
        onClick={onBack}
        className='-my-1 -ml-3 justify-self-start text-muted-foreground max-sm:h-11'
      >
        <ArrowLeft aria-hidden />
        All {isIncome ? 'income' : 'bills'}
      </Button>

      <header className='flex items-center gap-4'>
        <SeriesTile series={series} className='h-10 w-10' />
        <div className='min-w-0 flex-1'>
          <h3 className='text-section-title break-words'>{series.name}</h3>
          <p className='mt-0.5 text-sm text-muted-foreground'>
            {RECURRING_CADENCE_LABELS[series.cadence]}
            {series.hidden && ' · hidden'}
            {series.status === 'ENDED' && ' · ended'}
          </p>
        </div>
        <p className='shrink-0 text-right'>
          <span className={cn('block numeric text-2xl font-semibold', isIncome && 'text-success')}>
            {isIncome && '+'}
            {formatAmount(series)}
          </span>
          {monthly && (
            <span className='block numeric text-xs text-muted-foreground'>{monthly}</span>
          )}
        </p>
      </header>

      <Badges series={series} />

      <dl className='grid grid-cols-2 gap-px border bg-border sm:grid-cols-4'>
        <Fact
          label={
            isPast(series)
              ? 'Last paid'
              : `Next · ${formatRelativeDays(series.nextExpectedDate, asOf)}`
          }
          value={
            isPast(series)
              ? formatBankTransactionCompactDate(series.lastDate)
              : format(parseCalendarDate(series.nextExpectedDate), 'EEE d MMM')
          }
        />
        {/* A varying series' range is a badge above, where it can wrap; a fact holds one amount. */}
        {/* "Usually" is an estimate, so a whole amount, like the yearly total. */}
        <Fact
          label={series.amountKind === 'VARIABLE' ? 'Usually' : 'Price'}
          value={
            series.amountKind === 'VARIABLE'
              ? `≈ ${formatWholeMoney(series.typicalAmount, series.currency)}`
              : formatMoney(series.typicalAmount, series.currency)
          }
          numeric
        />
        {/* A yearly total is an estimate, so whole amounts; they also keep large totals on one line. */}
        <Fact
          label='A year'
          value={yearly !== null ? formatWholeMoney(yearly, baseCurrency) : '—'}
          numeric
        />
        <Fact
          label={`Since ${format(parseCalendarDate(series.firstDate), 'MMM yyyy')}`}
          value={`${series.transactionCount} ${series.transactionCount === 1 ? 'payment' : 'payments'}`}
        />
      </dl>

      <PaymentHistory series={series} />

      {continuation && (
        <p className='flex items-start gap-2 text-sm text-muted-foreground'>
          {continuation.linked ? (
            <Link2 aria-hidden className='mt-0.5 size-4 shrink-0' />
          ) : (
            <Link2Off aria-hidden className='mt-0.5 size-4 shrink-0' />
          )}
          <span>
            {continuation.linked ? 'Includes earlier payments to ' : 'Kept apart from '}
            <span className='font-medium text-foreground'>{continuation.previousName}</span> (
            {format(parseCalendarDate(continuation.previousFirstDate), 'MMM yyyy')} –{' '}
            {format(parseCalendarDate(continuation.previousLastDate), 'MMM yyyy')}).
          </span>
        </p>
      )}

      <div className='grid gap-2 border-t pt-4 sm:flex sm:flex-wrap'>
        <Button variant='outline' asChild className='max-sm:h-11'>
          <Link to='/bank-transactions' search={{recurringSeriesKey: series.key}}>
            <ArrowUpRight aria-hidden />
            Open in Transactions
          </Link>
        </Button>
        {continuation && (
          <Button
            variant='outline'
            className='max-sm:h-11'
            disabled={busy}
            onClick={() =>
              void update({
                kind: 'linked',
                key: series.key,
                linked: !continuation.linked,
                previousName: continuation.previousName,
              })
            }
          >
            {continuation.linked ? <Link2Off aria-hidden /> : <Link2 aria-hidden />}
            {continuation.linked
              ? `Unlink ${continuation.previousName}`
              : `Link with ${continuation.previousName}`}
          </Button>
        )}
        <Button
          variant='ghost'
          className='max-sm:h-11 sm:ml-auto'
          disabled={busy}
          onClick={() => void update({kind: 'hidden', key: series.key, hidden: !series.hidden})}
        >
          {series.hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
          {series.hidden ? 'Count as recurring again' : 'Not recurring'}
        </Button>
      </div>
    </section>
  );
}

function Badges({series}: {series: RecurringSeries}) {
  const items: React.ReactNode[] = [];
  if (series.flags.includes('LATE'))
    items.push(
      <Badge key='late' variant='outline' className='border-warning/60 text-warning'>
        Expected {formatBankTransactionCompactDate(series.nextExpectedDate)}, not paid yet
      </Badge>,
    );
  if (series.flags.includes('HIGHER_THAN_USUAL'))
    items.push(
      <Badge key='high' variant='outline' className='border-warning/60 text-warning'>
        Last payment {formatMoney(series.latestAmount, series.currency)}, higher than usual
      </Badge>,
    );
  if (series.amountRange)
    items.push(
      <Badge key='range' variant='secondary' className='numeric'>
        Last 6 {formatMoney(series.amountRange.low, series.currency)}–
        {formatMoney(series.amountRange.high, series.currency)}
      </Badge>,
    );
  if (series.priceChange)
    items.push(
      <Badge key='price' variant='secondary' className='numeric'>
        Price {formatPriceChange(series.priceChange, series.currency)}
      </Badge>,
    );
  if (items.length === 0) return null;
  return <div className='-mt-2 flex flex-wrap gap-2'>{items}</div>;
}

/** A label over one value; both stay on one line each, however narrow the cell. */
function Fact({label, value, numeric = false}: {label: string; value: string; numeric?: boolean}) {
  return (
    <div data-testid='recurring-fact' className='min-w-0 bg-card px-3 py-2.5'>
      <dt className='truncate text-xs text-muted-foreground'>{label}</dt>
      <dd className={cn('mt-0.5 truncate text-sm font-medium', numeric && 'numeric')}>{value}</dd>
    </div>
  );
}

/** Payments shown in the chart: the latest twelve, enough to see a price rise or a spike. */
const CHART_SIZE = 12;

/**
 * The series' payments: the latest twelve as bars on one scale, then every payment, newest first,
 * a page at a time.
 */
function PaymentHistory({series}: {series: RecurringSeries}) {
  const {data, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage} =
    useGetRecurringPayments(series.key);

  if (isPending) return <Skeleton className='h-40' aria-label='Loading payments' />;
  if (isError || !data) {
    return (
      <div className='grid justify-items-start gap-2'>
        <p className='text-sm'>Could not load payments.</p>
        <Button variant='outline' className='max-sm:h-11' onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const transactions = data.pages.flatMap((page) => page.transactions);
  const {total} = data.pages[data.pages.length - 1];
  return (
    <>
      <PaymentChart series={series} transactions={transactions.slice(0, CHART_SIZE)} />
      <section aria-label='Payments' className='grid grid-cols-1 gap-2'>
        <h4 className='text-xs font-medium text-muted-foreground'>
          {total === 1 ? '1 payment' : `All ${total} payments`}
        </h4>
        <ul aria-label={`Payments to ${series.name}`} className='-mx-3 divide-y divide-border/60'>
          {transactions.map((transaction) => (
            <li key={transaction.id}>
              <TransactionListRow
                transaction={transaction}
                link={{
                  to: '/bank-transactions',
                  search: {recurringSeriesKey: series.key, transactionId: transaction.id},
                }}
              />
            </li>
          ))}
        </ul>
        {hasNextPage && (
          <Button
            variant='ghost'
            className='w-full text-muted-foreground max-sm:h-11'
            disabled={isFetchingNextPage}
            aria-busy={isFetchingNextPage || undefined}
            onClick={() => void fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </section>
    </>
  );
}

/** The latest payments as bars on one scale; the list below holds the exact values. */
function PaymentChart({
  series,
  transactions,
}: {
  series: RecurringSeries;
  transactions: BankTransaction[];
}) {
  const points = [...transactions]
    .reverse()
    .map((tx) => ({
      date: tx.bookingDate ?? tx.transactionDate ?? '',
      amount: Math.abs(Number(tx.amount)),
    }))
    .filter((point) => point.date);
  if (points.length < 2) return null;
  const unusualIndex = series.flags.includes('HIGHER_THAN_USUAL') ? points.length - 1 : -1;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <section aria-label='Payment history' className='grid grid-cols-1 gap-2'>
      <h4 className='text-xs font-medium text-muted-foreground'>Last {points.length} payments</h4>
      <ChartContainer
        className='aspect-auto h-32 w-full'
        config={{amount: {color: 'hsl(var(--chart-primary))'}}}
        role='img'
        aria-label={`${points.length} payments from ${formatBankTransactionCompactDate(first.date)} to ${formatBankTransactionCompactDate(last.date)}, between ${formatMoney(Math.min(...points.map((p) => p.amount)), series.currency)} and ${formatMoney(Math.max(...points.map((p) => p.amount)), series.currency)}.`}
      >
        <BarChart
          data={points}
          margin={{left: 0, right: 0, top: 4, bottom: 0}}
          barCategoryGap='22%'
        >
          <XAxis
            dataKey='date'
            tickLine={false}
            axisLine={false}
            interval='preserveStartEnd'
            minTickGap={24}
            tickFormatter={(value: string) => format(parseCalendarDate(value), 'MMM')}
          />
          <ChartTooltip
            cursor={{fill: 'hsl(var(--foreground))', fillOpacity: 0.05}}
            content={({active, payload}) => {
              const point = payload?.[0]?.payload as (typeof points)[number] | undefined;
              if (!active || !point) return null;
              return (
                <div className='grid gap-0.5 border bg-card p-2 text-xs shadow-sm'>
                  <span className='text-muted-foreground'>
                    {formatBankTransactionCompactDate(point.date)}
                  </span>
                  <span className='numeric font-semibold'>
                    {formatMoney(point.amount, series.currency)}
                  </span>
                </div>
              );
            }}
          />
          <Bar dataKey='amount' isAnimationActive={false}>
            {points.map((point, index) => (
              <Cell
                key={`${point.date}-${index}`}
                fill={index === unusualIndex ? 'hsl(var(--warning))' : 'var(--color-amount)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </section>
  );
}
