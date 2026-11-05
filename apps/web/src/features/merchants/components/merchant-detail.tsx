import {Link} from '@tanstack/react-router';
import type {CashFlowInterval, MerchantGroup, MerchantGroupPeriod} from '@tempo/contracts';
import {format} from 'date-fns';
import {ArrowLeft} from 'lucide-react';
import {useState} from 'react';
import {Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis} from 'recharts';

import {Button} from '@/components/ui/button';
import {ChartContainer, ChartTooltip} from '@/components/ui/chart';
import {Skeleton} from '@/components/ui/skeleton';
import {TransactionListRow} from '@/features/banking/components/transaction-list-row';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {ChartCardError, ChartCardHeader} from '@/features/dashboard/components/chart-card';
import {TextAction} from '@/features/dashboard/components/text-action';
import {axisFormatter, axisTicks} from '@/features/dashboard/utils/chart-axis';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {formatMoney, formatWholeMoney, toCents} from '@/features/dashboard/utils/money';
import {latestWindow} from '@/features/dashboard/utils/period-window';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {useLocalDate} from '@/hooks/use-local-date';
import {cn} from '@/utils/cn';

import {useGetMerchantPeriods} from '../api/use-get-merchant-periods';
import {useGetMerchantTransactions} from '../api/use-get-merchant-transactions';
import {countLabel, formatFrequency} from '../utils/merchant-format';
import {MerchantTile} from './merchant-tile';

/** One merchant or person: what was paid all time, per period, under which names, and every transaction. */
export function MerchantDetail({merchant, onBack}: {merchant: MerchantGroup; onBack: () => void}) {
  const currency = merchant.baseCurrency;
  const hasIncome = toCents(merchant.received) > 0;
  const frequency = formatFrequency(merchant);
  const excluded = merchant.excluded.missingBaseAmount + merchant.excluded.unknownDirection;

  return (
    <div className='grid grid-cols-1 gap-6'>
      <Button
        variant='ghost'
        size='sm'
        onClick={onBack}
        className='-my-1 -ml-3 justify-self-start text-muted-foreground max-sm:h-11'
      >
        <ArrowLeft aria-hidden />
        All merchants
      </Button>

      <header className='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4'>
        <MerchantTile merchant={merchant} className='h-12 w-12' />
        <div className='min-w-0'>
          <h3 className='text-section-title wrap-anywhere'>{merchant.name}</h3>
          {merchant.variants.length > 1 && (
            <p className='mt-0.5 text-sm text-muted-foreground'>
              {merchant.variants.length} names grouped by brand
            </p>
          )}
        </div>
      </header>

      <section aria-label='All-time totals' className='grid grid-cols-1 gap-5'>
        <dl className='flex flex-wrap justify-between gap-x-8 gap-y-4'>
          <div className='min-w-0'>
            <dt className='text-xs text-muted-foreground'>Spent all time</dt>
            <dd className='numeric text-3xl font-semibold tracking-tight'>
              {formatMoney(merchant.spent, currency)}
            </dd>
            {toCents(merchant.refunded) > 0 && (
              <dd className='text-xs text-muted-foreground'>
                <span className='numeric'>{formatMoney(merchant.paid, currency)}</span> paid,{' '}
                <span className='numeric'>{formatMoney(merchant.refunded, currency)}</span> refunded
              </dd>
            )}
          </div>
          {hasIncome && (
            <div className='min-w-0 sm:text-right'>
              <dt className='text-xs text-muted-foreground'>Received</dt>
              <dd className='numeric text-3xl font-semibold tracking-tight text-success'>
                +{formatMoney(merchant.received, currency)}
              </dd>
            </div>
          )}
        </dl>
        <dl className='grid grid-cols-2 gap-px border bg-border sm:grid-cols-4'>
          <Fact label='Payments' value={merchant.paymentCount.toLocaleString()} numeric />
          <Fact
            label='Average payment'
            value={
              merchant.averagePayment === null
                ? '—'
                : formatMoney(merchant.averagePayment, currency)
            }
            numeric
          />
          <Fact
            label={
              merchant.firstDate
                ? `Since ${formatBankTransactionCompactDate(merchant.firstDate)}`
                : 'Since'
            }
            value={
              merchant.lastDate
                ? `Last ${formatBankTransactionCompactDate(merchant.lastDate)}`
                : '—'
            }
          />
          <Fact label='How often' value={frequency ?? '—'} />
        </dl>
        {excluded > 0 && (
          <p className='text-xs text-muted-foreground'>
            {countLabel(excluded, 'transaction')} without a converted amount or direction{' '}
            {excluded === 1 ? 'is' : 'are'} not counted.
          </p>
        )}
      </section>

      <PeriodsCard merchant={merchant} hasIncome={hasIncome} />

      {merchant.variants.length > 1 && (
        <section className='grid grid-cols-1 gap-3' aria-label='Grouped names'>
          <div>
            <h2 className='text-card-title'>Grouped names</h2>
            <p className='mt-1 text-xs text-muted-foreground'>
              These appear under one brand, so their totals add up above.
            </p>
          </div>
          <ul className='-mx-3 divide-y divide-border/60'>
            {merchant.variants.map((variant) => (
              <li
                key={variant.key}
                className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-sm'
              >
                <span className='min-w-0'>
                  <span className='block wrap-anywhere'>{variant.name}</span>
                  <span className='block text-xs text-muted-foreground'>
                    {countLabel(variant.count, 'transaction')}
                  </span>
                </span>
                <span className='numeric whitespace-nowrap'>
                  {formatMoney(variant.spent, currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Transactions merchant={merchant} />
    </div>
  );
}

/** A label over one value; both stay on one line each, however narrow the cell. */
function Fact({label, value, numeric = false}: {label: string; value: string; numeric?: boolean}) {
  return (
    <div data-testid='merchant-fact' className='min-w-0 bg-card px-3 py-2.5'>
      <dt className='truncate text-xs text-muted-foreground'>{label}</dt>
      <dd className={cn('mt-0.5 truncate text-sm font-medium', numeric && 'numeric')}>{value}</dd>
    </div>
  );
}

function PeriodsCard({merchant, hasIncome}: {merchant: MerchantGroup; hasIncome: boolean}) {
  const [interval, setInterval] = useState<CashFlowInterval>('month');
  const asOf = useLocalDate();
  const range = latestWindow(interval);
  const {from} = range;
  // `useLocalDate` can lag the clock by a moment after midnight; the API refuses a range ending after `asOf`.
  const to = range.to > asOf ? asOf : range.to;
  const {periods, isPending, isError, refetch} = useGetMerchantPeriods(
    merchant.id,
    interval,
    from,
    to,
    asOf,
  );
  const loaded = periods?.interval === interval ? periods : undefined;
  const shown = loaded?.periods ?? [];
  const hasActivity = shown.some((period) => period.count > 0);

  return (
    <section className='grid min-w-0 grid-cols-1 gap-4' aria-label='Spending over time'>
      <ChartCardHeader
        title='Over time'
        interval={interval}
        onIntervalChange={setInterval}
        toggleLabel='Group spending by'
      />
      {isError && !loaded ? (
        <ChartCardError message='Could not load spending over time.' onRetry={refetch} />
      ) : isPending || !loaded ? (
        <Skeleton className='h-56' role='img' aria-label='Loading spending over time' />
      ) : !hasActivity ? (
        <p className='text-sm text-muted-foreground'>
          Nothing in the last {shown.length} {interval}s.
        </p>
      ) : (
        <PeriodsChart
          periods={shown}
          interval={interval}
          currency={loaded.baseCurrency}
          showReceived={hasIncome}
        />
      )}
    </section>
  );
}

function periodLabel(period: MerchantGroupPeriod, interval: CashFlowInterval) {
  const start = parseCalendarDate(period.start);
  if (interval === 'year') return period.start.slice(0, 4);
  if (interval === 'month') return format(start, 'MMM yyyy');
  return `Week of ${format(start, 'd MMM yyyy')}`;
}

function PeriodsChart({
  periods,
  interval,
  currency,
  showReceived,
}: {
  periods: MerchantGroupPeriod[];
  interval: CashFlowInterval;
  currency: string | null;
  showReceived: boolean;
}) {
  const isMobile = useIsMobile();
  const shown = interval === 'week' && isMobile ? periods.slice(-13) : periods;
  const axis = axisFormatter(currency);
  const money = (value: string | number) =>
    interval === 'year' ? formatWholeMoney(value, currency) : formatMoney(value, currency);
  const ticks = axisTicks(
    0,
    Math.max(
      0,
      ...shown.flatMap((period) => [
        toCents(period.spent),
        showReceived ? toCents(period.received) : 0,
      ]),
    ),
  );
  const data = shown.map((period) => ({
    start: period.start,
    spent: Math.max(0, Number(period.spent)),
    received: Number(period.received),
  }));
  const tickLabel = (start: string) =>
    interval === 'year'
      ? start.slice(0, 4)
      : format(parseCalendarDate(start), interval === 'month' ? 'MMM' : 'd MMM');

  return (
    <div>
      <ChartContainer
        className='aspect-auto h-56 w-full'
        config={{
          spent: {color: 'hsl(var(--chart-primary))'},
          received: {color: 'hsl(var(--chart-secondary))'},
        }}
        role='img'
        aria-label={`Spending per ${interval}, ${periodLabel(shown[0], interval)} to ${periodLabel(shown[shown.length - 1], interval)}. The table below lists every bar.`}
      >
        <BarChart data={data} margin={{left: 0, right: 12, top: 8, bottom: 0}} barGap={1}>
          <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
          <XAxis
            dataKey='start'
            tickLine={false}
            axisLine={false}
            interval='preserveStartEnd'
            minTickGap={16}
            tickFormatter={tickLabel}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
            interval={0}
            tick={{className: 'numeric'}}
            tickFormatter={(value: number) => axis.format(value)}
          />
          <ChartTooltip
            cursor={{fill: 'hsl(var(--foreground))', fillOpacity: 0.04}}
            content={({active, label}) => {
              const period = shown.find((item) => item.start === label);
              if (!active || !period) return null;
              return (
                <div className='grid min-w-40 gap-1 border bg-card p-2.5 text-xs shadow-sm'>
                  <p className='font-semibold'>
                    {periodLabel(period, interval)}
                    {!period.complete && (
                      <span className='font-normal text-muted-foreground'> · so far</span>
                    )}
                  </p>
                  <p className='flex justify-between gap-4'>
                    <span className='text-muted-foreground'>Spent</span>
                    <span className='numeric'>{money(period.spent)}</span>
                  </p>
                  {showReceived && (
                    <p className='flex justify-between gap-4'>
                      <span className='text-muted-foreground'>Received</span>
                      <span className='numeric'>{money(period.received)}</span>
                    </p>
                  )}
                  <p className='text-muted-foreground'>{countLabel(period.count, 'transaction')}</p>
                </div>
              );
            }}
          />
          {showReceived && (
            <Bar
              dataKey='received'
              fill='var(--color-received)'
              maxBarSize={48}
              isAnimationActive={false}
            >
              {shown.map((period) => (
                <Cell key={period.start} fillOpacity={period.complete ? 1 : 0.5} />
              ))}
            </Bar>
          )}
          <Bar dataKey='spent' fill='var(--color-spent)' maxBarSize={48} isAnimationActive={false}>
            {shown.map((period) => (
              <Cell key={period.start} fillOpacity={period.complete ? 1 : 0.5} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className='sr-only focus-within:not-sr-only focus-within:mt-4 focus-within:max-w-full focus-within:overflow-x-auto'>
        <table
          aria-label={`Spending per ${interval}`}
          className='w-full text-right text-sm [&_td]:px-2 [&_td]:py-1 [&_td]:numeric [&_th]:px-2 [&_th]:py-2'
        >
          <thead>
            <tr>
              <th className='text-left'>Period</th>
              <th>Spent</th>
              {showReceived && <th>Received</th>}
              <th>Transactions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((period) => (
              <tr key={period.start}>
                <td className='text-left'>{periodLabel(period, interval)}</td>
                <td>{money(period.spent)}</td>
                {showReceived && <td>{money(period.received)}</td>}
                <td>{period.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Transactions({merchant}: {merchant: MerchantGroup}) {
  const {data, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage} =
    useGetMerchantTransactions(merchant.id);
  const transactions = data?.pages.flatMap((page) => page.transactions) ?? [];
  const total = data?.pages[data.pages.length - 1].total ?? merchant.count;

  return (
    <section className='grid grid-cols-1 gap-3' aria-label='Transactions'>
      <header className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
        <h2 className='text-card-title'>{countLabel(total, 'transaction')}</h2>
        <TextAction asChild className='-mr-2'>
          <Link to='/bank-transactions' search={{merchantGroup: merchant.id}}>
            Open in Transactions
          </Link>
        </TextAction>
      </header>
      {isPending ? (
        <Skeleton className='h-40' aria-label='Loading transactions' />
      ) : isError || !data ? (
        <div className='grid justify-items-start gap-2'>
          <p className='text-sm'>Could not load transactions.</p>
          <Button variant='outline' className='max-sm:h-11' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <ul
            aria-label={`Transactions with ${merchant.name}`}
            className='-mx-3 divide-y divide-border/60'
          >
            {transactions.map((transaction) => (
              <li key={transaction.id}>
                <TransactionListRow
                  transaction={transaction}
                  link={{
                    to: '/bank-transactions',
                    search: {merchantGroup: merchant.id, transactionId: transaction.id},
                  }}
                />
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <TextAction
              disabled={isFetchingNextPage}
              aria-busy={isFetchingNextPage || undefined}
              onClick={() => void fetchNextPage()}
              className='-ml-2'
            >
              Load more
            </TextAction>
          )}
        </>
      )}
    </section>
  );
}
