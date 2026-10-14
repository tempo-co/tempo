import {Link, useNavigate} from '@tanstack/react-router';
import {format, startOfWeek, subWeeks} from 'date-fns';
import {type ReactNode, useState} from 'react';
import {Bar, BarChart, CartesianGrid, Cell, ReferenceArea, XAxis, YAxis} from 'recharts';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {ChartContainer, ChartTooltip} from '@/components/ui/chart';
import {Skeleton} from '@/components/ui/skeleton';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

import {useGetBankTransactionCashFlow} from '../api/use-get-bank-transaction-cash-flow';
import type {CashFlowInterval, CashFlowPeriod} from '../types/bank-transaction-cash-flow';
import {cashFlowDrill, flowDrill, parseCalendarDate} from '../utils/drill-links';
import {formatMoney, toCents} from '../utils/money';
import {currentMonth, formatMonth, localDate, monthDates, shiftMonth} from '../utils/month';

const INTERVALS: {value: CashFlowInterval; label: string; noun: string}[] = [
  {value: 'week', label: 'Week', noun: 'week'},
  {value: 'month', label: 'Month', noun: 'month'},
  {value: 'year', label: 'Year', noun: 'year'},
];
const WEEKS_SHOWN = 26;
const WEEKS_SHOWN_PHONE = 13;
const MONTHS_SHOWN = 12;
const YEARS_SHOWN = 10;

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

/** Four equal, round steps that cover the tallest bar, so gridlines read as a ruler. */
function axisTicks(cents: number) {
  const rough = (Math.max(cents / 100, 100) * 1.06) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * magnitude >= rough)! * magnitude;
  return [0, 1, 2, 3, 4].map((index) => index * step);
}

/** "€4K" on the axis; a plain "4K" before the owner has a base currency. */
function axisFormatter(currency: string | null) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
    ...(currency ? {style: 'currency', currency, currencyDisplay: 'narrowSymbol'} : {}),
  });
}

/** Year totals read better without cents; weeks and months keep them so they match the list. */
function moneyFor(interval: CashFlowInterval, currency: string | null) {
  if (interval !== 'year') return (value: string | number) => formatMoney(value, currency);
  const whole = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
    ...(currency ? {style: 'currency', currency} : {}),
  });
  return (value: string | number) => whole.format(Number(value));
}

/** Opaque, so the selected-month band never tints income into a different-looking series. */
const incomeSwatch = 'bg-[hsl(37_16%_72%)] dark:bg-[hsl(36_6%_40%)]';

/** The dates to load for each zoom level. Month loads a year more than it shows, for last year's month. */
function requestRange(interval: CashFlowInterval, month: string) {
  const today = localDate();
  if (interval === 'week') {
    const thisWeek = startOfWeek(parseCalendarDate(today), {weekStartsOn: 1});
    return {from: format(subWeeks(thisWeek, WEEKS_SHOWN - 1), 'yyyy-MM-dd'), to: today};
  }
  if (interval === 'year')
    return {from: `${Number(today.slice(0, 4)) - (YEARS_SHOWN - 1)}-01-01`, to: today};
  const thisMonth = currentMonth();
  // The window ends at the current month, or at the selected month once it falls out of view.
  const windowEnd =
    month > shiftMonth(thisMonth, -MONTHS_SHOWN) ? thisMonth : shiftMonth(month, MONTHS_SHOWN - 1);
  return {
    from: `${shiftMonth(windowEnd, -(MONTHS_SHOWN * 2 - 1))}-01`,
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

  const shown = (() => {
    if (!loaded) return [];
    const periods = loaded.periods;
    if (interval === 'week') return periods.slice(-(isMobile ? WEEKS_SHOWN_PHONE : WEEKS_SHOWN));
    if (interval === 'month') return periods.slice(-MONTHS_SHOWN);
    return periods;
  })();
  const noun = INTERVALS.find((item) => item.value === interval)!.noun;

  return (
    <Card className='@container grid min-w-0 gap-5 p-5 sm:p-6' data-testid='cash-flow'>
      <header className='flex flex-wrap items-start justify-between gap-x-6 gap-y-3'>
        <div className='min-w-0'>
          <h2 className='text-base font-semibold'>Cash flow</h2>
          {loaded && <Averages periods={shown} noun={noun} currency={loaded.baseCurrency} />}
        </div>
        <ToggleGroup
          type='single'
          variant='outline'
          size='sm'
          value={interval}
          onValueChange={(value) => value && setGrouping(value as CashFlowInterval)}
          aria-label='Group cash flow by'
        >
          {INTERVALS.map((item) => (
            <ToggleGroupItem
              key={item.value}
              value={item.value}
              className='min-h-9 px-3 text-xs data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-secondary-foreground'
            >
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
          <Comparison
            periods={interval === 'week' ? shown : loaded.periods}
            interval={interval}
            selectedMonth={month}
            currency={loaded.baseCurrency}
          />
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
              className='font-mono font-medium tabular-nums underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
            >
              {formatMoney(amount, currency)}
            </Link>
          </dd>
        </div>
      ))}
      <div className='flex items-baseline gap-1.5'>
        <dt className='text-muted-foreground'>{net < 0 ? 'Overspent' : 'Kept'}</dt>
        <dd className={cn('font-mono font-medium tabular-nums', net > 0 && 'text-success')}>
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
  // A single full period is not an average; the comparison below already states it.
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
      <span className='font-mono font-medium text-foreground tabular-nums'>
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
  const hint =
    interval === 'month'
      ? 'Select a month to show it below.'
      : `Select a ${interval} to see its transactions.`;
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
          spending: {color: 'hsl(var(--primary))'},
          income: {theme: {light: 'hsl(37 16% 72%)', dark: 'hsl(36 6% 40%)'}},
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
                    'text-[11px]',
                    start === selected ? 'fill-primary font-semibold' : 'fill-muted-foreground',
                  )}
                >
                  {tickLabel(start)}
                  {interval === 'month' && firstOfYear.has(start) && (
                    <tspan
                      x={props.x}
                      dy={13}
                      className='fill-muted-foreground text-[10px] font-normal'
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
            tick={{className: 'font-mono'}}
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
                  <TooltipRow label='Spent' value={money(period.spending)} swatch='bg-primary' />
                  <TooltipRow
                    label={net >= 0 ? 'Kept' : 'Overspent'}
                    value={money(Math.abs(net) / 100)}
                    className={net > 0 ? 'text-success' : undefined}
                  />
                </div>
              );
            }}
          />
          <Bar dataKey='income' fill='var(--color-income)' isAnimationActive={false}>
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
          <i className='size-2.5 bg-primary' />
          Spent
        </span>
        {runningLabel && (
          <span className='flex items-center gap-1.5'>
            <i className='size-2.5 bg-[repeating-linear-gradient(135deg,hsl(var(--primary))_0_1.5px,transparent_1.5px_3px)] ring-1 ring-primary/40 ring-inset' />
            {runningLabel}
          </span>
        )}
        <span className='ms-auto hidden sm:inline'>{hint}</span>
      </div>
      <div className='sr-only focus-within:not-sr-only focus-within:mt-4 focus-within:max-w-full focus-within:overflow-x-auto'>
        <table
          aria-label={`Spending and income per ${interval}`}
          className='w-full text-right text-sm [&_td]:px-2 [&_td]:py-1 [&_td]:font-mono [&_td]:tabular-nums [&_th]:px-2 [&_th]:py-2'
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
      <span className={cn('font-mono tabular-nums', className)}>{value}</span>
    </p>
  );
}

/**
 * One plain-language comparison under the chart. Month: the selected month against the same month
 * last year. Week: last full week against the average full week before it. Year: last full year
 * against the one before.
 */
function Comparison({
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
  const money = moneyFor(interval, currency);
  if (interval === 'month') {
    const byMonth = new Map(periods.map((period) => [monthOf(period), period]));
    const previous = shiftMonth(selectedMonth, -12);
    const current = byMonth.get(selectedMonth);
    const lastYear = byMonth.get(previous);
    if (!lastYear) return <Footnote>No {formatMonth(previous)} to compare with yet.</Footnote>;
    // History starting partway through last year's month would make this month look dearer.
    if (!lastYear.complete)
      return (
        <Footnote>
          {formatMonth(previous)} is only partly synced, so there is nothing to compare.
        </Footnote>
      );
    if (!current || !current.complete) {
      return (
        <Footnote>
          Same month last year, {formatMonth(previous)}: spent{' '}
          <Amount>{money(lastYear.spending)}</Amount>, income{' '}
          <Amount>{money(lastYear.income)}</Amount>
        </Footnote>
      );
    }
    return (
      <Difference
        lead={`${formatMonth(selectedMonth)} vs ${formatMonth(previous)}`}
        current={toCents(current.spending)}
        reference={toCents(lastYear.spending)}
        detail={
          <>
            {formatMonth(previous)}: <Amount>{money(lastYear.spending)}</Amount> spent ·{' '}
            <Amount>{money(lastYear.income)}</Amount> income
          </>
        }
        money={money}
      />
    );
  }

  const complete = periods.filter((period) => period.complete);
  const latest = complete[complete.length - 1] as CashFlowPeriod | undefined;
  if (!latest) return null;

  if (interval === 'week') {
    const earlier = complete.slice(0, -1);
    if (earlier.length === 0) return null;
    // The median, so the one week a month that carries rent doesn't make every other week look cheap.
    const sorted = earlier.map((period) => toCents(period.spending)).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const typical =
      sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
    return (
      <Difference
        lead={`Last week (${formatWeek(latest)}) vs a typical week`}
        current={toCents(latest.spending)}
        reference={typical}
        detail={
          <>
            <Amount>{money(latest.spending)}</Amount> spent · typical{' '}
            <Amount>{money(typical / 100)}</Amount>, the median of the {earlier.length} weeks before
          </>
        }
        money={money}
      />
    );
  }

  const before = complete[complete.length - 2] as CashFlowPeriod | undefined;
  const year = latest.start.slice(0, 4);
  if (!before) {
    return (
      <Footnote>
        {year}: spent <Amount>{money(latest.spending)}</Amount>, income{' '}
        <Amount>{money(latest.income)}</Amount>
      </Footnote>
    );
  }
  return (
    <Difference
      lead={`${year} vs ${before.start.slice(0, 4)}`}
      current={toCents(latest.spending)}
      reference={toCents(before.spending)}
      detail={
        <>
          <Amount>{money(latest.spending)}</Amount> spent · <Amount>{money(latest.income)}</Amount>{' '}
          income
        </>
      }
      money={money}
    />
  );
}

function Difference({
  lead,
  current,
  reference,
  detail,
  money,
}: {
  lead: string;
  current: number;
  reference: number;
  detail: ReactNode;
  money: (value: string | number) => string;
}) {
  const difference = current - reference;
  const percent = Math.round((Math.abs(difference) / Math.max(1, reference)) * 100);
  return (
    <div className='flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t pt-4 text-sm'>
      <p>
        <span className='text-muted-foreground'>{lead}: </span>
        <span
          className={cn(
            'font-medium',
            difference > 0 ? 'text-primary' : difference < 0 && 'text-success',
          )}
        >
          {difference === 0 ? (
            'the same spending'
          ) : (
            <>
              <span className='font-mono tabular-nums'>{money(Math.abs(difference) / 100)}</span>{' '}
              {difference > 0 ? 'more' : 'less'} spent ({difference > 0 ? '+' : '−'}
              {percent}%)
            </>
          )}
        </span>
      </p>
      <p className='text-xs text-muted-foreground'>{detail}</p>
    </div>
  );
}

function Footnote({children}: {children: ReactNode}) {
  return <p className='border-t pt-4 text-sm text-muted-foreground'>{children}</p>;
}

function Amount({children}: {children: ReactNode}) {
  return <span className='font-mono font-medium text-foreground tabular-nums'>{children}</span>;
}
