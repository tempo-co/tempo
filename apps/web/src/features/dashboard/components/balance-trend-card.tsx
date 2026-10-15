import {format} from 'date-fns';
import {useState} from 'react';
import {Area, AreaChart, CartesianGrid, XAxis, YAxis} from 'recharts';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {ChartContainer, ChartTooltip} from '@/components/ui/chart';
import {Skeleton} from '@/components/ui/skeleton';
import type {BankConnection} from '@/features/banking/types/bank-connection';
import {resolveBankAccountLabel} from '@/features/banking/utils/formatters';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

import {useGetBankBalanceTrend} from '../api/use-get-bank-balance-trend';
import type {BalanceTrendPeriod} from '../types/bank-balance-trend';
import type {CashFlowInterval} from '../types/bank-transaction-cash-flow';
import {axisFormatter, axisTicks} from '../utils/chart-axis';
import {parseCalendarDate} from '../utils/drill-links';
import {formatMoney, formatWholeMoney, toCents} from '../utils/money';
import {formatMonth, localDate} from '../utils/month';
import {latestWindow, shownWeeks} from '../utils/period-window';
import {IntervalToggle} from './interval-toggle';

const day = (value: string) => parseCalendarDate(value);

/** A point with a total; points without one are left off the line. */
type TotalPeriod = BalanceTrendPeriod & {total: string};
const hasTotal = (period: BalanceTrendPeriod): period is TotalPeriod => period.total !== null;

/** How a date reads at each zoom level: "2026", "Aug 2026" or "5 Aug". */
const DATE_LABEL: Record<CashFlowInterval, (date: string) => string> = {
  year: (date) => date.slice(0, 4),
  month: (date) => formatMonth(date.slice(0, 7)),
  week: (date) => format(day(date), 'd MMM'),
};

/** Below this, a percentage change says more about the small start than about the money. */
const MIN_PERCENT_BASE_CENTS = 100_00;

/** "31 Aug 2026" for a past period's end; "today" while it is running. */
function pointName(period: BalanceTrendPeriod) {
  return period.complete ? format(day(period.end), 'd MMM yyyy') : 'Today';
}

function startName(period: BalanceTrendPeriod, interval: CashFlowInterval) {
  return interval === 'week'
    ? DATE_LABEL.week(period.end)
    : `end of ${DATE_LABEL[interval](period.start)}`;
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
    <Card className='@container grid min-w-0 gap-5 p-5 sm:p-6' data-testid='balance-trend'>
      <header className='flex flex-wrap items-start justify-between gap-x-6 gap-y-3'>
        <div className='min-w-0'>
          <h2 className='text-base font-semibold'>Total balance</h2>
          {loaded && periods.length > 1 && (
            <Change periods={periods} interval={interval} currency={loaded.baseCurrency} />
          )}
        </div>
        <IntervalToggle value={interval} onChange={setGrouping} label='Show total balance by' />
      </header>
      {isError && !loaded ? (
        <div className='grid justify-items-start gap-3'>
          <p className='text-sm'>Could not load the balance trend.</p>
          <Button variant='outline' size='sm' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending || !loaded ? (
        <Skeleton className='h-[17rem]' role='img' aria-label='Loading total balance' />
      ) : periods.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {!loaded.baseCurrency
            ? 'The balance trend appears once Tempo has picked a base currency.'
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
          {interval !== 'year' && (
            <LateAccounts
              accounts={loaded.accounts}
              periods={periods}
              interval={interval}
              labels={labels}
            />
          )}
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

/** The latest total and how far it moved since the first point shown. */
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
  // Only accounts already counted at the first point, so an account joining is not growth.
  const held = new Set(
    first.accounts.filter((account) => account.balance !== null).map((account) => account.id),
  );
  const sumHeld = (period: BalanceTrendPeriod) =>
    period.accounts.reduce(
      (sum, account) =>
        held.has(account.id) && account.balance !== null ? sum + toCents(account.balance) : sum,
      0,
    );
  const difference = sumHeld(last) - sumHeld(first);
  const base = Math.abs(sumHeld(first));
  const percent =
    base >= MIN_PERCENT_BASE_CENTS ? Math.round((Math.abs(difference) / base) * 100) : null;
  return (
    <p className='mt-1 text-xs text-muted-foreground'>
      <span className='font-mono font-medium text-foreground tabular-nums'>
        {formatMoney(last.total, currency)}
      </span>{' '}
      {last.complete ? `on ${pointName(last)}` : 'today'} ·{' '}
      <span
        className={cn(
          'font-mono font-medium tabular-nums',
          difference > 0 ? 'text-success' : 'text-foreground',
        )}
      >
        {difference >= 0 ? '+' : '−'}
        {formatMoney(Math.abs(difference) / 100, currency)}
        {percent !== null && ` (${difference >= 0 ? '+' : '−'}${percent}%)`}
      </span>{' '}
      <span className='whitespace-nowrap'>since {startName(first, interval)}</span>
    </p>
  );
}

/** Accounts whose history starts inside the window make the line jump; say so. */
function LateAccounts({
  accounts,
  periods,
  interval,
  labels,
}: {
  accounts: {id: string; since: string}[];
  periods: TotalPeriod[];
  interval: CashFlowInterval;
  labels: Map<string, string>;
}) {
  const late = accounts.filter(
    ({since}) => since > periods[0].end && since <= periods[periods.length - 1].end,
  );
  if (late.length === 0) return null;
  return (
    <p className='-mt-2 text-xs text-muted-foreground'>
      {late
        .map(
          ({id, since}) =>
            `${labels.get(id) ?? 'An account'} counts from ${DATE_LABEL[interval](since)}`,
        )
        .join(' · ')}
      , when its history in Tempo starts, and is left out of the change.
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
  const labelEvery = interval === 'year' ? 1 : interval === 'week' ? 4 : isMobile ? 2 : 1;
  const labelled = new Set(
    periods
      .filter((_, index) => (periods.length - 1 - index) % labelEvery === 0)
      .map((period) => period.start),
  );
  const labelledStarts = [...labelled];
  const firstOfYear = new Set(
    labelledStarts.filter(
      (start, index) => index === 0 || labelledStarts[index - 1].slice(0, 4) !== start.slice(0, 4),
    ),
  );
  // Months drop the year here; it sits under the first month of each year instead.
  const tickLabel = (start: string) =>
    interval === 'month' ? format(day(start), 'MMM') : DATE_LABEL[interval](start);

  return (
    <div>
      <ChartContainer
        className='aspect-auto h-56 w-full'
        config={{total: {color: 'hsl(var(--primary))'}}}
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
              if (!labelled.has(start)) return <g />;
              return (
                <text
                  x={props.x}
                  y={Number(props.y) + 12}
                  textAnchor='middle'
                  className='fill-muted-foreground text-[11px]'
                >
                  {tickLabel(start)}
                  {interval === 'month' && firstOfYear.has(start) && (
                    <tspan x={props.x} dy={13} className='text-[10px]'>
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
            tick={{className: 'font-mono'}}
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
                    <span className='font-mono tabular-nums'>{money(period.total)}</span>
                  </p>
                  {period.accounts.map((account) => (
                    <p key={account.id} className='flex items-center justify-between gap-4'>
                      <span className='truncate text-muted-foreground'>
                        {labels.get(account.id) ?? 'Bank account'}
                      </span>
                      <span className='font-mono tabular-nums'>
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
                  className='fill-card stroke-primary'
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
            <i className='size-2.5 rounded-full border-2 border-primary' />
            Today
          </span>
        )}
      </div>
      <div className='sr-only'>
        <table
          aria-label={`Total balance per ${interval}`}
          className='w-full text-right text-sm [&_td]:px-2 [&_td]:py-1 [&_td]:font-mono [&_td]:tabular-nums [&_th]:px-2 [&_th]:py-2'
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
