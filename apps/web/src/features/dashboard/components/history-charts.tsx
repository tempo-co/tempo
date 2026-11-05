import {useRef} from 'react';
import {Area, CartesianGrid, ComposedChart, ReferenceDot, XAxis, YAxis} from 'recharts';

import {ChartContainer, ChartTooltip} from '@/components/ui/chart';
import {cn} from '@/utils/cn';

import {axisFormatter, axisTicks} from '../utils/chart-axis';
import {signed, signedEvent, wholeCents} from '../utils/format';
import {formatMonth} from '../utils/month';
import type {MonthPoint} from '../utils/overview';

/** Both charts share these insets, so a month's dot sits right above its bar. */
export const Y_WIDTH = 52;
const RIGHT = 12;

/** Month-end balance as one line; one-off payments are dots on it. Months sit at slot centres, like the bars below. */
export function BalanceChart({
  months,
  currency,
  onPick,
}: {
  months: MonthPoint[];
  currency: string | null;
  onPick: (month: string) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const axis = axisFormatter(currency);
  const data = months.map((point, index) => ({
    index,
    month: point.month,
    balance: point.balance === null ? null : point.balance / 100,
    point,
  }));
  const known = months.flatMap((point) => (point.balance === null ? [] : [point.balance]));
  const ticks = axisTicks(Math.min(0, ...known), Math.max(0, ...known));
  const n = data.length;
  const every = n > 14 ? 3 : 1;
  const xTicks = data
    .filter((d) => (n > 40 ? d.month.endsWith('-01') : d.index % every === (n - 1) % every))
    .map((d) => d.index);
  const first = known[0];
  const last = known[known.length - 1];
  return (
    <div ref={plotRef}>
      <ChartContainer
        className='aspect-auto h-56 w-full sm:h-64'
        config={{balance: {color: 'hsl(var(--chart-primary))'}}}
        role='img'
        aria-label={
          first === undefined
            ? 'Total balance at each month end.'
            : `Total balance at each month end, from ${wholeCents(first, currency)} to ${wholeCents(last, currency)}. One-off payments are marked.`
        }
      >
        <ComposedChart
          data={data}
          margin={{left: 0, right: RIGHT, top: 10, bottom: 0}}
          onClick={(_state, event) => {
            // From where the click landed, not the tooltip: a tap or click without a hover first has no active month.
            const plot = plotRef.current?.getBoundingClientRect();
            const {clientX} = event as unknown as MouseEvent;
            if (!plot || typeof clientX !== 'number') return;
            const left = plot.left + Y_WIDTH;
            const index = Math.floor(((clientX - left) / (plot.width - Y_WIDTH - RIGHT)) * n);
            if (data[index]) onPick(data[index].month);
          }}
        >
          <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
          <XAxis
            dataKey='index'
            type='number'
            domain={[-0.5, n - 0.5]}
            ticks={xTicks}
            tickLine={false}
            axisLine={false}
            tick={{className: 'text-caption fill-muted-foreground'}}
            tickFormatter={(index: number) => {
              const month = data[index]?.month;
              if (!month) return '';
              return n > 40 ? month.slice(0, 4) : formatMonth(month, n > 14 ? 'MMM yy' : 'MMM');
            }}
          />
          <YAxis
            width={Y_WIDTH}
            tickLine={false}
            axisLine={false}
            domain={[ticks[0], ticks[ticks.length - 1]]}
            ticks={ticks}
            tick={{className: 'numeric text-caption fill-muted-foreground'}}
            tickFormatter={(value: number) => axis.format(value)}
          />
          <Area
            dataKey='balance'
            type='monotone'
            stroke='var(--color-balance)'
            strokeWidth={2}
            fill='var(--color-balance)'
            fillOpacity={0.08}
            isAnimationActive={false}
            activeDot={{r: 4}}
          />
          {data.flatMap((d) =>
            d.balance === null
              ? []
              : d.point.events.map((event) => (
                  <ReferenceDot
                    key={event.id}
                    x={d.index}
                    y={d.balance!}
                    r={4.5}
                    fill={
                      event.direction === 'INCOME'
                        ? 'hsl(var(--success))'
                        : 'hsl(var(--foreground))'
                    }
                    stroke='hsl(var(--card))'
                    strokeWidth={2}
                  />
                )),
          )}
          <ChartTooltip
            cursor={{stroke: 'hsl(var(--border))'}}
            content={({active, payload}) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row) return null;
              const point = row.point;
              return (
                <div className='grid min-w-48 gap-1 border bg-card p-2.5 text-xs shadow-sm'>
                  <p className='font-semibold'>{formatMonth(point.month, 'MMMM yyyy')}</p>
                  <TipRow label='Balance' value={wholeCents(point.balance, currency)} strong />
                  <TipRow label='Kept' value={signed(point.kept, currency)} />
                  {point.events.map((event) => (
                    <TipRow
                      key={event.id}
                      label={event.name}
                      value={signedEvent(event, currency)}
                    />
                  ))}
                </div>
              );
            }}
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

function TipRow({label, value, strong}: {label: string; value: string; strong?: boolean}) {
  return (
    <p className='flex items-center justify-between gap-4'>
      <span className='truncate text-muted-foreground'>{label}</span>
      <span className={strong ? 'numeric font-semibold' : 'numeric'}>{value}</span>
    </p>
  );
}

/** What was kept each month, on the same slots as the line above: up is kept, down is more out than in. */
export function KeptStrip({
  months,
  currency,
  onPick,
}: {
  months: MonthPoint[];
  currency: string | null;
  onPick: (month: string) => void;
}) {
  const max = Math.max(1, ...months.map((point) => Math.abs(point.kept)));
  return (
    <div>
      <p
        className='mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-label text-muted-foreground'
        style={{paddingLeft: Y_WIDTH, paddingRight: RIGHT}}
      >
        <span>Kept each month</span>
        <span className='inline-flex flex-wrap gap-x-3 font-normal'>
          <span className='inline-flex items-center gap-1'>
            <i aria-hidden='true' className='h-2.5 w-1.5 bg-chart-primary' />
            kept
          </span>
          <span className='inline-flex items-center gap-1'>
            <i aria-hidden='true' className='h-2.5 w-1.5 bg-warning' />
            more out than in
          </span>
          <span>faded = so far</span>
        </span>
      </p>
      <ol
        className='flex h-24'
        style={{paddingLeft: Y_WIDTH, paddingRight: RIGHT}}
        aria-label='Kept each month'
      >
        {months.map((point) => {
          const up = point.kept >= 0;
          const label = `${formatMonth(point.month, 'MMMM yyyy')}${point.complete ? '' : ' so far'}: kept ${signed(point.kept, currency)}`;
          return (
            <li key={point.month} className='relative min-w-0 flex-1'>
              <button
                type='button'
                onClick={() => onPick(point.month)}
                title={label}
                aria-label={label}
                className='group absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
              >
                <span aria-hidden='true' className='absolute inset-x-0 top-1/2 h-px bg-border' />
                <span
                  aria-hidden='true'
                  className={cn(
                    'absolute inset-x-[18%] group-hover:opacity-80',
                    up ? 'bottom-1/2 bg-chart-primary' : 'top-1/2 bg-warning',
                    !point.complete && 'opacity-40',
                  )}
                  style={{height: `${(Math.abs(point.kept) / max) * 50}%`}}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
