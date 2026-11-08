import {format} from 'date-fns';
import {type ReactNode, useLayoutEffect, useRef, useState} from 'react';
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
import {parseCalendarDate} from '../utils/drill-links';
import {signed, wholeCents} from '../utils/format';
import {formatMonth} from '../utils/month';
import type {BalancePoint} from '../utils/overview';
import {Readout, ReadoutRow, ReadoutTitle} from './data-tip';
import {Bone} from './loading';

/** The plot's insets, which the loading placeholder keeps too. */
const TOP = 10;
const RIGHT = 12;
/** The date axis under the line. */
const X_HEIGHT = 30;
/** Between the y axis' labels, which end against the plot, and the plot. */
const Y_GAP = 6;
/** The y axis' room before its labels are measured: about what `€32K` takes. */
const Y_PLACEHOLDER = 34;
/** From each end of the plot to the first and last point: room for the end dot, and to hover the end points. */
const X_PAD = 6;
/** With a mouse, a point shows a pointer, since a click opens its month. */
const POINTER = '[@media(hover:hover)_and_(pointer:fine)]:cursor-pointer';
/**
 * The line's box. Beside the details it fills their height (12rem to 40rem), so neither column leaves a gap below
 * it; stacked, it keeps a fixed height.
 */
const BALANCE_BOX =
  'relative flex min-h-72 flex-1 flex-col sm:min-h-80 @[60rem]:max-h-[40rem] @[60rem]:min-h-48';
/** The y axis' labels, which {@link useLabelWidth} measures in the same type. */
const Y_TICK = 'numeric text-caption';

/**
 * The width of the widest of `labels` set in the y axis' type, so the axis takes only that room. Measured before
 * paint, and again if the font loads later.
 */
function useLabelWidth(labels: string[]) {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(Y_PLACEHOLDER - Y_GAP);
  const key = labels.join('|');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.ceil(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  const measurer = (
    <span
      ref={ref}
      aria-hidden='true'
      className={cn(
        Y_TICK,
        'pointer-events-none invisible absolute top-0 left-0 flex w-max flex-col',
      )}
    >
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </span>
  );
  return {width, measurer};
}

/**
 * The balance at each month end, or at each day end over the last month. Hovering, or pressing and sliding on touch,
 * reads out a point; a click or a quick tap opens its month.
 */
export function BalanceChart({
  points,
  unit,
  currency,
  onPick,
}: {
  points: BalancePoint[];
  unit: 'month' | 'day';
  currency: string | null;
  onPick: (month: string) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const axis = axisFormatter(currency);
  const data = points.map((point, index) => ({
    index,
    balance: point.balance === null ? null : point.balance / 100,
    point,
  }));
  const known = points.flatMap((point) => (point.balance === null ? [] : [point.balance]));
  const ticks = axisTicks(Math.min(0, ...known), Math.max(0, ...known));
  const {width: labelWidth, measurer} = useLabelWidth(ticks.map((value) => axis.format(value)));
  const yWidth = labelWidth + Y_GAP;
  const n = data.length;
  // Days about weekly, months every one or every third, ending at the latest; long spans mark each year.
  const every = unit === 'day' ? 7 : n > 14 ? 3 : 1;
  const xTicks = data
    .filter((d) =>
      unit === 'month' && n > 40
        ? d.point.month.endsWith('-01')
        : d.index % every === (n - 1) % every,
    )
    .map((d) => d.index);
  const first = known[0];
  const last = known[known.length - 1];
  // A month's name alone says which one opens, unless the span holds that month in two years.
  const ambiguous = (month: string) =>
    points.filter((point) => point.month !== month && point.month.slice(5) === month.slice(5))
      .length > 0;
  return (
    <div ref={plotRef} className={BALANCE_BOX}>
      {measurer}
      <ChartContainer
        className={cn('aspect-auto min-h-0 w-full flex-1', POINTER)}
        config={{balance: {color: 'hsl(var(--chart-primary))'}}}
        role='img'
        aria-label={
          first === undefined
            ? `Total balance at each ${unit} end.`
            : `Total balance at each ${unit} end, from ${wholeCents(first, currency)} to ${wholeCents(last, currency)}.`
        }
      >
        <ComposedChart
          data={data}
          margin={{left: 0, right: RIGHT, top: TOP, bottom: 0}}
          // Recharts sets its own cursor; the container's applies instead.
          style={{cursor: 'inherit'}}
          onClick={(_state, event) => {
            // From where the click landed, not the tooltip: a tap or click without a hover first has no active point.
            const plot = plotRef.current?.getBoundingClientRect();
            const {clientX} = event as unknown as MouseEvent;
            if (!plot || typeof clientX !== 'number') return;
            // Over the axis labels or the right margin, outside the plot, a click opens nothing.
            const x = clientX - plot.left - yWidth;
            const width = plot.width - yWidth - RIGHT;
            if (x < 0 || x > width) return;
            const index = nearestIndex(x, width, n);
            if (data[index]) onPick(data[index].point.month);
          }}
        >
          <CartesianGrid vertical={false} stroke='hsl(var(--border))' />
          <XAxis
            dataKey='index'
            type='number'
            // A lone point sits in the middle.
            domain={n > 1 ? [0, n - 1] : [-1, 1]}
            padding={{left: X_PAD, right: X_PAD}}
            ticks={xTicks}
            tickLine={false}
            axisLine={false}
            tick={{className: 'text-caption fill-muted-foreground'}}
            tickFormatter={(index: number) => {
              const point = data[index]?.point;
              if (!point) return '';
              if (unit === 'day') return format(parseCalendarDate(point.key), 'd MMM');
              return n > 40
                ? point.month.slice(0, 4)
                : formatMonth(point.month, n > 14 ? 'MMM yy' : 'MMM');
            }}
          />
          <YAxis
            width={yWidth}
            tickLine={false}
            tickSize={0}
            tickMargin={Y_GAP}
            axisLine={false}
            domain={[ticks[0], ticks[ticks.length - 1]]}
            ticks={ticks}
            tick={{className: cn(Y_TICK, 'fill-muted-foreground')}}
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
            cursor={<PointBand count={n} />}
            // A month without a balance still reads out what was kept.
            filterNull={false}
            content={({active, payload}) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row) return null;
              const point = row.point;
              const before = data[row.index - 1]?.point.balance;
              const change =
                unit === 'day' && point.balance !== null && before != null
                  ? point.balance - before
                  : null;
              return (
                <Readout>
                  <ReadoutTitle note={point.complete ? undefined : 'so far'}>
                    {unit === 'day'
                      ? format(parseCalendarDate(point.key), 'EEE d MMM')
                      : formatMonth(point.month, 'MMMM yyyy')}
                  </ReadoutTitle>
                  <ReadoutRow label='Balance' value={wholeCents(point.balance, currency)} strong />
                  {point.kept !== undefined && (
                    <ReadoutRow label='Kept' value={signed(point.kept, currency)} />
                  )}
                  {change !== null && (
                    <ReadoutRow label='Change' value={signed(change, currency)} />
                  )}
                  {/* The point's slot is what opens its month; this only says so. */}
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

/**
 * The point nearest to `x` px into a plot `width` px wide holding `count` points, which sit {@link X_PAD} in from
 * either end; each point owns the stretch closer to it than to its neighbours, out to the plot's edges.
 */
function nearestIndex(x: number, width: number, count: number) {
  if (count <= 1) return 0;
  const step = (width - 2 * X_PAD) / (count - 1);
  return Math.min(count - 1, Math.max(0, Math.round((x - X_PAD) / step)));
}

/** The line's box at its loaded size, with a quiet placeholder where the plot will be, or `children` instead. */
export function BalanceChartSkeleton({children}: {children?: ReactNode}) {
  return (
    <div className={BALANCE_BOX}>
      {/* The plot, inside the axes' room. */}
      <div
        data-slot='plot-placeholder'
        className='flex min-h-0 flex-1'
        style={{margin: `${TOP}px ${RIGHT}px ${X_HEIGHT}px ${Y_PLACEHOLDER}px`}}
      >
        {children ?? <Bone className='flex-1 opacity-60' />}
      </div>
    </div>
  );
}

/** The line's cursor: the stretch of the plot the active point owns, behind the grid and the line. */
function PointBand({
  count,
  points,
  left,
  top,
  width,
  height,
  className,
}: {
  count: number;
  points?: {x: number}[];
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  const x = points?.[0]?.x;
  if (x === undefined || width === undefined || left === undefined) return null;
  const half = count > 1 ? (width - 2 * X_PAD) / (count - 1) / 2 : width / 2;
  const from = Math.max(left, x - half);
  const to = Math.min(left + width, x + half);
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.grid - 1}>
      <rect
        data-slot='point-band'
        className={className}
        x={from}
        y={top}
        width={to - from}
        height={height}
        fill='hsl(var(--accent))'
        stroke='none'
        pointerEvents='none'
      />
    </ZIndexLayer>
  );
}
