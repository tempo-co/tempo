import {useRef} from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  DefaultZIndexes,
  XAxis,
  YAxis,
  ZIndexLayer,
} from 'recharts';

import {ChartContainer, ChartTooltip} from '@/components/ui/chart';
import {cn} from '@/utils/cn';

import {axisFormatter, axisTicks} from '../utils/chart-axis';
import {signed, wholeCents} from '../utils/format';
import {formatMonth} from '../utils/month';
import type {MonthPoint} from '../utils/overview';
import {Readout, ReadoutRow, ReadoutTitle} from './data-tip';
import {Bone} from './loading';

/** The plot's insets, which the loading placeholder keeps too. */
const Y_WIDTH = 52;
const RIGHT = 12;
/** The month axis under the line. */
const X_HEIGHT = 30;
/** With a mouse, a month shows a pointer, since a click opens it. */
const POINTER = '[@media(hover:hover)_and_(pointer:fine)]:cursor-pointer';
/**
 * The line's box. Beside the details it fills their height (12rem to 40rem), so neither column leaves a gap below
 * it; stacked, it keeps a fixed height.
 */
const BALANCE_BOX =
  'flex min-h-72 flex-1 flex-col sm:min-h-80 @[60rem]:max-h-[40rem] @[60rem]:min-h-48';

/**
 * The balance at each month end. Hovering, or pressing and sliding on touch, reads out a month; a click or a quick
 * tap opens it.
 */
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
  // A month's name alone says which one opens, unless the span holds that month in two years.
  const ambiguous = (month: string) =>
    months.filter((point) => point.month.slice(5) === month.slice(5)).length > 1;
  return (
    <div ref={plotRef} className={BALANCE_BOX}>
      <ChartContainer
        className={cn('aspect-auto min-h-0 w-full flex-1', POINTER)}
        config={{balance: {color: 'hsl(var(--chart-primary))'}}}
        role='img'
        aria-label={
          first === undefined
            ? 'Total balance at each month end.'
            : `Total balance at each month end, from ${wholeCents(first, currency)} to ${wholeCents(last, currency)}.`
        }
      >
        <ComposedChart
          data={data}
          margin={{left: 0, right: RIGHT, top: 10, bottom: 0}}
          // Recharts sets its own cursor; the container's applies instead.
          style={{cursor: 'inherit'}}
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
          <ChartTooltip
            cursor={<MonthBand count={n} />}
            // A month without a balance still reads out what was kept.
            filterNull={false}
            content={({active, payload}) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row) return null;
              const point = row.point;
              return (
                <Readout>
                  <ReadoutTitle note={point.complete ? undefined : 'so far'}>
                    {formatMonth(point.month, 'MMMM yyyy')}
                  </ReadoutTitle>
                  <ReadoutRow label='Balance' value={wholeCents(point.balance, currency)} strong />
                  <ReadoutRow label='Kept' value={signed(point.kept, currency)} />
                  {/* The month's slot is what opens it; this only says so. */}
                  <p className='whitespace-nowrap text-muted-foreground'>
                    Open {formatMonth(point.month, ambiguous(point.month) ? 'MMMM yyyy' : 'MMMM')} ›
                  </p>
                </Readout>
              );
            }}
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

/** The line's box at its loaded size, with a quiet placeholder where the plot will be. */
export function BalanceChartSkeleton() {
  return (
    <div className={BALANCE_BOX}>
      {/* The plot, inside the axes' room. */}
      <div
        className='flex min-h-0 flex-1'
        style={{margin: `10px ${RIGHT}px ${X_HEIGHT}px ${Y_WIDTH}px`}}
      >
        <Bone className='flex-1 opacity-60' />
      </div>
    </div>
  );
}

/** The line's cursor: the active month's whole x slot, behind the grid and the line. */
function MonthBand({
  count,
  points,
  top,
  width,
  height,
  className,
}: {
  count: number;
  points?: {x: number}[];
  top?: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  const x = points?.[0]?.x;
  if (x === undefined || width === undefined) return null;
  const slot = width / count;
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.grid - 1}>
      <rect
        data-slot='month-band'
        className={className}
        x={x - slot / 2}
        y={top}
        width={slot}
        height={height}
        fill='hsl(var(--accent))'
        stroke='none'
        pointerEvents='none'
      />
    </ZIndexLayer>
  );
}
