import type {BankBalanceTrendPeriod, BankConnection, CashFlowInterval} from '@tempo/contracts';
import {format} from 'date-fns';
import {useState} from 'react';
import {Area, AreaChart, CartesianGrid, XAxis, YAxis} from 'recharts';

import {Card} from '@/components/ui/card';
import {ChartContainer, ChartTooltip} from '@/components/ui/chart';
import {Skeleton} from '@/components/ui/skeleton';
import {resolveBankAccountLabel} from '@/features/banking/utils/formatters';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

import {useGetBankBalanceTrend} from '../api/use-get-bank-balance-trend';
import {axisFormatter, axisTicks, firstOfYear, labelEvery} from '../utils/chart-axis';
import {parseCalendarDate} from '../utils/drill-links';
import {formatMoney, formatWholeMoney, toCents} from '../utils/money';
import {formatMonth, localDate} from '../utils/month';
import {latestWindow, shownWeeks} from '../utils/period-window';
import {ChartCardError, ChartCardHeader} from './chart-card';

const day = (value: string) => parseCalendarDate(value);

/** A point with a total; points without one are left off the line. */
type TotalPeriod = BankBalanceTrendPeriod & {total: string};
const hasTotal = (period: BankBalanceTrendPeriod): period is TotalPeriod => period.total !== null;

/** How a date reads at each zoom level: "2026", "Aug 2026" or "5 Aug". */
const DATE_LABEL: Record<CashFlowInterval, (date: string) => string> = {
  year: (date) => date.slice(0, 4),
  month: (date) => formatMonth(date.slice(0, 7)),
  week: (date) => format(day(date), 'd MMM'),
};

/** "31 Aug 2026" for a past period's end; "today" while it is running. */
function pointName(period: BankBalanceTrendPeriod) {
  return period.complete ? format(day(period.end), 'd MMM yyyy') : 'Today';
}

/** "on 26 Apr", "at the end of November 2025" or "at the end of 2021". */
function startName(period: BankBalanceTrendPeriod, interval: CashFlowInterval) {
  return interval === 'week'
    ? `on ${DATE_LABEL.week(period.end)}`
    : `at the end of ${DATE_LABEL[interval](period.start)}`;
}

/**
 * The combined balance of the connected accounts at the end of each week, month or year, on an
 * axis from zero so growth reads at its true size.
 */
export function BalanceTrendCard({connections}: {connections: BankConnection[]}) {
  const [interval, setGrouping] = useState<CashFlowInterval>('month');
  const isMobile = useIsMobile();
  const {from, to} = latestWindow(interval);
  const {balanceTrend, isPending, isError, refetch} = useGetBankBalanceTrend(
    interval,
    from,
    to,
    localDate(),
  );
  const loaded = balanceTrend?.interval === interval ? balanceTrend : undefined;
  const inView =
    interval === 'week' ? shownWeeks(loaded?.periods ?? [], isMobile) : (loaded?.periods ?? []);
  const periods = inView.filter(hasTotal);
  const withoutRate = inView.length - periods.length;
  const labels = new Map(
    connections.flatMap((connection) =>
      connection.bankAccounts.map((account) => [account.id, resolveBankAccountLabel(account)]),
    ),
  );

  return (
    <Card className='@container grid min-w-0 gap-4 p-5 sm:p-6' data-testid='balance-trend'>
      <ChartCardHeader
        title='Total balance'
        interval={interval}
        onIntervalChange={setGrouping}
        toggleLabel='Show total balance by'
      >
        {loaded && periods.length > 1 && (
          <Change periods={periods} interval={interval} currency={loaded.baseCurrency} />
        )}
      </ChartCardHeader>
      {isError && !loaded ? (
        <ChartCardError message='Could not load the balance trend.' onRetry={refetch} />
      ) : isPending || !loaded ? (
        <Skeleton className='h-[17rem]' role='img' aria-label='Loading total balance' />
      ) : periods.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {!loaded.baseCurrency
            ? 'The balance trend appears shortly after your first sync.'
            : withoutRate > 0
              ? 'The balance trend appears once exchange rates for your accounts are in.'
              : 'No balance history yet.'}
        </p>
      ) : (
        <>
          <BalanceChart
            periods={periods}
            interval={interval}
            currency={loaded.baseCurrency}
            labels={labels}
          />
          {withoutRate > 0 && (
            <p className='-mt-2 text-xs text-muted-foreground'>
              {withoutRate === 1 ? 'One point is' : `${withoutRate} points are`} left out until its
              exchange rate is in.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** The latest total and how far the line moved since its first point. */
function Change({
  periods,
  interval,
  currency,
}: {
  periods: TotalPeriod[];
  interval: CashFlowInterval;
  currency: string | null;
}) {
  const first = periods[0];
  const last = periods[periods.length - 1];
  const difference = toCents(last.total) - toCents(first.total);
  return (
    <p className='col-span-2 text-xs text-muted-foreground'>
      <span className='numeric font-medium text-foreground'>
        {formatMoney(last.total, currency)}
      </span>{' '}
      {last.complete ? `on ${pointName(last)}` : 'now'} ·{' '}
      {difference === 0 ? (
        'the same as'
      ) : (
        <>
          <span
            className={cn(
              'numeric font-medium',
              difference > 0 ? 'text-success' : 'text-foreground',
            )}
          >
            {formatMoney(Math.abs(difference) / 100, currency)}
          </span>{' '}
          {difference > 0 ? 'more than' : 'less than'}
        </>
      )}{' '}
      <span className='whitespace-nowrap'>{startName(first, interval)}</span>
    </p>
  );
}

function BalanceChart({
  periods,
  interval,
  currency,
  labels,
}: {
  periods: TotalPeriod[];
  interval: CashFlowInterval;
  currency: string | null;
  labels: Map<string, string>;
}) {
  const axis = axisFormatter(currency);
  const money = (value: string) => formatWholeMoney(value, currency);
  const totals = periods.map((period) => toCents(period.total));
  const ticks = axisTicks(Math.min(...totals), Math.max(...totals));
  const isMobile = useIsMobile();
  const data = periods.map((period) => ({start: period.start, total: Number(period.total)}));
  const last = periods[periods.length - 1];
  // Labelled like the cash flow chart above: counted back from the latest, years under months.
  const every = labelEvery(interval, isMobile);
  const labelled = new Map(
    periods
      .filter((_, index) => (periods.length - 1 - index) % every === 0)
      .map((period) => [period.start, interval === 'week' ? period.end : period.start]),
  );
  const yearStarts = firstOfYear([...labelled.keys()]);
  // Months drop the year here; it sits under the first month of each year instead.
  const tickLabel = (start: string) =>
    interval === 'month' ? format(day(start), 'MMM') : DATE_LABEL[interval](start);

  return (
    <div>
      <ChartContainer
        className='aspect-auto h-56 w-full'
        config={{total: {color: 'hsl(var(--chart-primary))'}}}
        role='img'
        aria-label={`Total balance at the end of each ${interval}, ${pointName(periods[0])} to ${pointName(last)}. A table with every total follows for screen readers.`}
      >
        <AreaChart data={data} margin={{left: 0, right: 18, top: 8, bottom: 0}}>
          <defs>
            <linearGradient id='balance-trend-fill' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor='var(--color-total)' stopOpacity={0.22} />
              <stop offset='100%' stopColor='var(--color-total)' stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
          <XAxis
            dataKey='start'
            tickLine={false}
            axisLine={false}
            interval={0}
            height={interval === 'month' ? 34 : 22}
            // Points sit in the middle of each period's slot, over the cash flow bars above.
            scale='band'
            tick={(props) => {
              const start = String(props.payload.value);
              const date = labelled.get(start);
              if (!date) return <g />;
              return (
                <text
                  x={props.x}
                  y={Number(props.y) + 12}
                  textAnchor='middle'
                  className='fill-muted-foreground text-caption'
                >
                  {tickLabel(date)}
                  {interval === 'month' && yearStarts.has(start) && (
                    <tspan x={props.x} dy={13} className='text-caption'>
                      {start.slice(0, 4)}
                    </tspan>
                  )}
                </text>
              );
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[ticks[0], ticks[ticks.length - 1]]}
            ticks={ticks}
            interval={0}
            tick={{className: 'numeric'}}
            tickFormatter={(value: number) => axis.format(value)}
          />
          <ChartTooltip
            cursor={{stroke: 'hsl(var(--foreground))', strokeOpacity: 0.2}}
            content={({active, label}) => {
              const period = periods.find((item) => item.start === label);
              if (!active || !period) return null;
              return (
                <div className='grid min-w-48 gap-1 border bg-card p-2.5 text-xs shadow-sm'>
                  <p className='flex items-baseline justify-between gap-4 font-semibold'>
                    {pointName(period)}
                    <span className='numeric'>{money(period.total)}</span>
                  </p>
                  {period.accounts.map((account) => (
                    <p key={account.id} className='flex items-center justify-between gap-4'>
                      <span className='truncate text-muted-foreground'>
                        {labels.get(account.id) ?? 'Bank account'}
                      </span>
                      <span className='numeric'>
                        {account.balance === null ? '–' : money(account.balance)}
                      </span>
                    </p>
                  ))}
                </div>
              );
            }}
          />
          <Area
            dataKey='total'
            type='linear'
            stroke='var(--color-total)'
            strokeWidth={2}
            fill='url(#balance-trend-fill)'
            isAnimationActive={false}
            dot={(props: {cx?: number; cy?: number; index?: number}) =>
              props.index === periods.length - 1 && !last.complete ? (
                <circle
                  key='today'
                  cx={props.cx}
                  cy={props.cy}
                  r={4}
                  className='fill-card stroke-chart-primary'
                  strokeWidth={2}
                />
              ) : (
                <g key={props.index} />
              )
            }
            activeDot={{r: 3.5, strokeWidth: 0}}
          />
        </AreaChart>
      </ChartContainer>
      <div className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground'>
        <span>Balance at the end of each {interval}</span>
        {!last.complete && (
          <span className='flex items-center gap-1.5'>
            <i className='size-2.5 rounded-full border-2 border-chart-primary' />
            Today
          </span>
        )}
      </div>
      <div className='sr-only'>
        <table
          aria-label={`Total balance per ${interval}`}
          className='w-full text-right text-sm [&_td]:px-2 [&_td]:py-1 [&_td]:numeric [&_th]:px-2 [&_th]:py-2'
        >
          <thead>
            <tr>
              <th className='text-left'>Date</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period.start}>
                <td className='text-left'>{pointName(period)}</td>
                <td>{money(period.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
