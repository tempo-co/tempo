import {Link, useNavigate} from '@tanstack/react-router';
import {format} from 'date-fns';
import {useState} from 'react';
import {Bar, BarChart, CartesianGrid, Cell, ReferenceArea, XAxis, YAxis} from 'recharts';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {ChartContainer, ChartTooltip} from '@/components/ui/chart';
import {Skeleton} from '@/components/ui/skeleton';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

import {useGetBankTransactionCashFlow} from '../api/use-get-bank-transaction-cash-flow';
import type {CashFlowInterval, CashFlowPeriod} from '../types/bank-transaction-cash-flow';
import {axisFormatter, axisTicks} from '../utils/chart-axis';
import {cashFlowDrill, flowDrill, parseCalendarDate} from '../utils/drill-links';
import {formatMoney, formatWholeMoney, toCents} from '../utils/money';
import {currentMonth, formatMonth, localDate, monthDates, shiftMonth} from '../utils/month';
import {MONTHS_SHOWN, latestWindow, shownWeeks} from '../utils/period-window';
import {IntervalToggle} from './interval-toggle';

const day = (value: string) => parseCalendarDate(value);
const monthOf = (period: CashFlowPeriod) => period.start.slice(0, 7);
const monthSearch = (month: string) => (month === currentMonth() ? {} : {month});

/** "6–12 Oct", or "29 Sep – 5 Oct" across a month boundary. */
function formatWeek(period: CashFlowPeriod) {
  const start = day(period.start);
  const end = day(period.end);
  return start.getMonth() === end.getMonth()
    ? `${format(start, 'd')}–${format(end, 'd MMM')}`
    : `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`;
}

function periodName(period: CashFlowPeriod, interval: CashFlowInterval) {
  if (interval === 'week') return formatWeek(period);
  if (interval === 'month') return formatMonth(monthOf(period));
  return period.start.slice(0, 4);
}

/** Year totals read better without cents; weeks and months keep them so they match the list. */
function moneyFor(interval: CashFlowInterval, currency: string | null) {
  return interval === 'year'
    ? (value: string | number) => formatWholeMoney(value, currency)
    : (value: string | number) => formatMoney(value, currency);
}

/** Opaque, so the selected-month band never tints income into a different-looking series. */
const incomeSwatch = 'bg-chart-secondary ring-1 ring-chart-secondary-edge ring-inset';

/** The dates to load for each zoom level. */
function requestRange(interval: CashFlowInterval, month: string) {
  if (interval !== 'month') return latestWindow(interval);
  const today = localDate();
  const thisMonth = currentMonth();
  // The window ends at the current month, or at the selected month once it falls out of view.
  const windowEnd =
    month > shiftMonth(thisMonth, -MONTHS_SHOWN) ? thisMonth : shiftMonth(month, MONTHS_SHOWN - 1);
  return {
    from: `${shiftMonth(windowEnd, -(MONTHS_SHOWN - 1))}-01`,
    to: windowEnd === thisMonth ? today : monthDates(windowEnd).to,
  };
}

/**
 * Spending and income per week, month or year on one fixed scale, so periods compare directly.
 * Selecting a month moves the rest of Home to it; a week or year opens its transactions.
 */
export function CashFlowCard({month}: {month: string}) {
  const [interval, setGrouping] = useState<CashFlowInterval>('month');
  const isMobile = useIsMobile();
  const {from, to} = requestRange(interval, month);
  const {cashFlow, isPending, isError, refetch} = useGetBankTransactionCashFlow(
    interval,
    from,
    to,
    localDate(),
  );
  const loaded = cashFlow?.interval === interval ? cashFlow : undefined;

  const periods = loaded?.periods ?? [];
  const shown = interval === 'week' ? shownWeeks(periods, isMobile) : periods;

  return (
    <Card className='@container grid min-w-0 gap-5 p-5 sm:p-6' data-testid='cash-flow'>
      <header className='flex flex-wrap items-start justify-between gap-x-6 gap-y-3'>
        <div className='min-w-0'>
          <h2 className='text-card-title'>Cash flow</h2>
          {loaded && <Averages periods={shown} noun={interval} currency={loaded.baseCurrency} />}
        </div>
        <IntervalToggle value={interval} onChange={setGrouping} label='Group cash flow by' />
      </header>
      {isError && !loaded ? (
        <div className='grid justify-items-start gap-3'>
          <p className='text-sm'>Could not load cash flow.</p>
          <Button variant='outline' size='sm' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending || !loaded ? (
        <Skeleton className='h-[19rem]' role='img' aria-label='Loading cash flow' />
      ) : shown.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No synced transactions in this period yet.</p>
      ) : (
        <>
          <CashFlowChart
            periods={shown}
            interval={interval}
            selectedMonth={month}
            currency={loaded.baseCurrency}
          />
          {interval === 'month' && (
            <SelectedMonth
              period={loaded.periods.find((period) => monthOf(period) === month)}
              currency={loaded.baseCurrency}
            />
          )}
        </>
      )}
    </Card>
  );
}

/** The selected month's totals, each linking to exactly the rows behind it. */
function SelectedMonth({
  period,
  currency,
}: {
  period: CashFlowPeriod | undefined;
  currency: string | null;
}) {
  if (!period) return null;
  const net = toCents(period.net);
  return (
    <dl
      className='-mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm'
      data-testid='cash-flow-selected-month'
    >
      {(
        [
          ['SPENDING', `${formatMonth(monthOf(period))} spent`, period.spending],
          ['INCOME', 'Income', period.income],
        ] as const
      ).map(([flow, label, amount]) => (
        <div key={flow} className='flex items-baseline gap-1.5'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd>
            <Link
              to='/bank-transactions'
              search={flowDrill(flow, period.start, period.end, true)}
              className='numeric font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
            >
              {formatMoney(amount, currency)}
            </Link>
          </dd>
        </div>
      ))}
      <div className='flex items-baseline gap-1.5'>
        <dt className='text-muted-foreground'>{net < 0 ? 'Overspent' : 'Kept'}</dt>
        <dd className={cn('numeric font-medium', net > 0 && 'text-success')}>
          {formatMoney(Math.abs(net) / 100, currency)}
        </dd>
      </div>
    </dl>
  );
}

/** Averages over complete periods only; a running period is still filling in. */
function Averages({
  periods,
  noun,
  currency,
}: {
  periods: CashFlowPeriod[];
  noun: string;
  currency: string | null;
}) {
  const complete = periods.filter((period) => period.complete);
  // A single full period is not an average.
  if (complete.length < 2) return null;
  const sum = (key: 'spending' | 'income') =>
    complete.reduce((total, period) => total + toCents(period[key]), 0);
  const spent = sum('spending');
  const earned = sum('income');
  const saved = earned - spent;
  const rate = earned > 0 ? Math.round((saved / earned) * 100) : null;
  return (
    <p className='mt-1 text-xs text-muted-foreground'>
      Average {noun} ({complete.length} full {noun}s):{' '}
      <span className='numeric font-medium text-foreground'>
        {formatMoney(spent / complete.length / 100, currency)}
      </span>{' '}
      spent
      {rate !== null && (
        <>
          {' · '}
          <span className='whitespace-nowrap'>
            <span
              className={cn(
                'font-medium tabular-nums',
                saved > 0 ? 'text-success' : 'text-foreground',
              )}
            >
              {Math.abs(rate)}%
            </span>{' '}
            of income {saved >= 0 ? 'kept' : 'overspent'}
          </span>
        </>
      )}
    </p>
  );
}

function CashFlowChart({
  periods,
  interval,
  selectedMonth,
  currency,
}: {
  periods: CashFlowPeriod[];
  interval: CashFlowInterval;
  selectedMonth: string;
  currency: string | null;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const axis = axisFormatter(currency);
  const money = moneyFor(interval, currency);
  const ticks = axisTicks(
    0,
    Math.max(...periods.flatMap((period) => [toCents(period.spending), toCents(period.income)])),
  );
  const data = periods.map((period) => ({
    start: period.start,
    spending: Number(period.spending),
    income: Number(period.income),
  }));
  const selected =
    interval === 'month'
      ? periods.find((period) => monthOf(period) === selectedMonth)?.start
      : undefined;
  const last = periods[periods.length - 1];
  const running = last.complete ? undefined : last;

  // Months: every month (every other on phones), and the selected month always, clearing its
  // neighbours. Weeks: every fourth Monday, counted back from the latest. Years: all.
  const labelEvery = interval === 'year' ? 1 : interval === 'week' ? 4 : isMobile ? 2 : 1;
  const selectedIndex = periods.findIndex((period) => period.start === selected);
  const labelled = new Set(
    periods
      .filter((period, index) =>
        period.start === selected
          ? true
          : selectedIndex >= 0 && Math.abs(index - selectedIndex) < labelEvery
            ? false
            : (periods.length - 1 - index) % labelEvery === 0,
      )
      .map((period) => period.start),
  );
  const firstOfYear = new Set(
    [...labelled].filter(
      (start, index, list) => index === 0 || list[index - 1].slice(0, 4) !== start.slice(0, 4),
    ),
  );
  const tickLabel = (start: string) =>
    interval === 'year'
      ? start.slice(0, 4)
      : interval === 'month'
        ? format(day(start), 'MMM')
        : format(day(start), 'd MMM');

  const open = (period: CashFlowPeriod) => {
    if (interval === 'month') void navigate({to: '/', search: monthSearch(monthOf(period))});
    else void navigate({to: '/bank-transactions', search: cashFlowDrill(period.start, period.end)});
  };
  // The running period reads as "so far"; a first period cut by where history starts is "partial".
  const partialCount = periods.filter((period) => !period.complete).length;
  const runningLabel =
    partialCount === 0
      ? null
      : running && partialCount === 1
        ? interval === 'week'
          ? 'This week so far'
          : interval === 'month'
            ? `${format(day(running.start), 'MMM')} so far`
            : `${running.start.slice(0, 4)} so far`
        : 'Partial period';

  return (
    <div>
      <ChartContainer
        className='aspect-auto h-64 w-full'
        config={{
          spending: {color: 'hsl(var(--chart-primary))'},
          income: {color: 'hsl(var(--chart-secondary))'},
        }}
        role='img'
        aria-label={`Spending and income per ${interval}, ${periodName(periods[0], interval)} to ${periodName(periods[periods.length - 1], interval)}. The table below lists every bar.`}
      >
        <BarChart
          data={data}
          margin={{left: 0, right: 18, top: 8, bottom: 0}}
          barGap={1}
          barCategoryGap={periods.length > 16 ? '18%' : '24%'}
          onClick={(state) => {
            const index = Number(state.activeTooltipIndex);
            if (Number.isInteger(index) && periods[index]) open(periods[index]);
          }}
          className='cursor-pointer'
        >
          <defs>
            <pattern
              id='cash-flow-so-far'
              width='4'
              height='4'
              patternUnits='userSpaceOnUse'
              patternTransform='rotate(45)'
            >
              <rect width='4' height='4' fill='var(--color-spending)' fillOpacity={0.35} />
              <line y2='4' stroke='var(--color-spending)' strokeWidth={2.5} />
            </pattern>
          </defs>
          <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
          {selected && (
            <ReferenceArea
              x1={selected}
              x2={selected}
              fill='hsl(var(--foreground))'
              fillOpacity={0.09}
              ifOverflow='visible'
            />
          )}
          <XAxis
            dataKey='start'
            tickLine={false}
            axisLine={false}
            interval={0}
            height={interval === 'month' ? 34 : 22}
            tick={(props) => {
              const start = String(props.payload.value);
              if (!labelled.has(start)) return <g />;
              return (
                <text
                  x={props.x}
                  y={Number(props.y) + 12}
                  textAnchor='middle'
                  className={cn(
                    'text-caption',
                    start === selected ? 'fill-primary font-semibold' : 'fill-muted-foreground',
                  )}
                >
                  {tickLabel(start)}
                  {interval === 'month' && firstOfYear.has(start) && (
                    <tspan
                      x={props.x}
                      dy={13}
                      className='fill-muted-foreground text-caption font-normal'
                    >
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
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
            interval={0}
            tick={{className: 'numeric'}}
            tickFormatter={(value: number) => axis.format(value)}
          />
          <ChartTooltip
            cursor={{fill: 'hsl(var(--foreground))', fillOpacity: 0.04}}
            content={({active, label}) => {
              const period = periods.find((item) => item.start === label);
              if (!active || !period) return null;
              const net = toCents(period.net);
              return (
                <div className='grid min-w-44 gap-1 border bg-card p-2.5 text-xs shadow-sm'>
                  <p className='font-semibold'>
                    {interval === 'week'
                      ? `Week of ${formatWeek(period)}`
                      : periodName(period, interval)}
                    {!period.complete && (
                      <span className='font-normal text-muted-foreground'> · so far</span>
                    )}
                  </p>
                  <TooltipRow label='Income' value={money(period.income)} swatch={incomeSwatch} />
                  <TooltipRow
                    label='Spent'
                    value={money(period.spending)}
                    swatch='bg-chart-primary'
                  />
                  <TooltipRow
                    label={net >= 0 ? 'Kept' : 'Overspent'}
                    value={money(Math.abs(net) / 100)}
                    className={net > 0 ? 'text-success' : undefined}
                  />
                </div>
              );
            }}
          />
          <Bar
            dataKey='income'
            fill='var(--color-income)'
            stroke='hsl(var(--chart-secondary-edge))'
            strokeWidth={1}
            isAnimationActive={false}
          >
            {periods.map((period) => (
              <Cell key={period.start} fillOpacity={period.complete ? 1 : 0.5} />
            ))}
          </Bar>
          <Bar dataKey='spending' fill='var(--color-spending)' isAnimationActive={false}>
            {periods.map((period) => (
              <Cell
                key={period.start}
                fill={period.complete ? 'var(--color-spending)' : 'url(#cash-flow-so-far)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1.5'>
          <i className={cn('size-2.5', incomeSwatch)} />
          Income
        </span>
        <span className='flex items-center gap-1.5'>
          <i className='size-2.5 bg-chart-primary' />
          Spent
        </span>
        {runningLabel && (
          <span className='flex items-center gap-1.5'>
            <i className='size-2.5 bg-[repeating-linear-gradient(135deg,hsl(var(--chart-primary))_0_1.5px,transparent_1.5px_3px)] ring-1 ring-chart-primary/40 ring-inset' />
            {runningLabel}
          </span>
        )}
      </div>
      <div className='sr-only focus-within:not-sr-only focus-within:mt-4 focus-within:max-w-full focus-within:overflow-x-auto'>
        <table
          aria-label={`Spending and income per ${interval}`}
          className='w-full text-right text-sm [&_td]:px-2 [&_td]:py-1 [&_td]:numeric [&_th]:px-2 [&_th]:py-2'
        >
          <thead>
            <tr>
              <th className='text-left'>
                {interval === 'week' ? 'Week' : interval === 'month' ? 'Month' : 'Year'}
              </th>
              <th>Spent</th>
              <th>Income</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period.start}>
                <td className='text-left'>
                  <Link
                    {...(interval === 'month'
                      ? {to: '/', search: monthSearch(monthOf(period))}
                      : {
                          to: '/bank-transactions',
                          search: cashFlowDrill(period.start, period.end),
                        })}
                    className='underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                  >
                    {periodName(period, interval)}
                  </Link>
                </td>
                <td>{money(period.spending)}</td>
                <td>{money(period.income)}</td>
                <td>{money(period.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TooltipRow({
  label,
  value,
  swatch,
  className,
}: {
  label: string;
  value: string;
  swatch?: string;
  className?: string;
}) {
  return (
    <p className='flex items-center justify-between gap-4'>
      <span className='flex items-center gap-1.5 text-muted-foreground'>
        {swatch && <i className={cn('size-2', swatch)} />}
        {label}
      </span>
      <span className={cn('numeric', className)}>{value}</span>
    </p>
  );
}
