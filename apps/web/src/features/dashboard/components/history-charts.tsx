import {useEffect, useRef, useState} from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  DefaultZIndexes,
  XAxis,
  YAxis,
  ZIndexLayer,
  useActiveTooltipLabel,
  useIsTooltipActive,
} from 'recharts';

import {ChartContainer, ChartTooltip, ChartTouchArea} from '@/components/ui/chart';
import {endChartInspection, inspectChartAt, useChartTouchState} from '@/hooks/use-chart-touch';
import {cn} from '@/utils/cn';

import {axisFormatter, axisTicks} from '../utils/chart-axis';
import {signed, wholeCents} from '../utils/format';
import {formatMonth} from '../utils/month';
import type {MonthPoint} from '../utils/overview';
import {Readout, ReadoutRow, ReadoutTitle} from './data-tip';

/** Both charts share these insets, so a month's dot sits right above its bar. */
const Y_WIDTH = 52;
const RIGHT = 12;
/** With a mouse, a month on either chart shows a pointer, since a click opens it. */
const POINTER = '[@media(hover:hover)_and_(pointer:fine)]:cursor-pointer';

/**
 * The balance line, then what was kept each month on the same x slots. One press-and-slide surface covers both:
 * the readout follows the finger and both charts mark the month under it; a quick tap opens that month.
 */
export function HistoryCharts({
  months,
  currency,
  onPick,
}: {
  months: MonthPoint[];
  currency: string | null;
  onPick: (month: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <ChartTouchArea className='flex min-h-0 flex-1 flex-col gap-5'>
      <BalanceChart months={months} currency={currency} onPick={onPick} onActive={setActive} />
      <KeptStrip months={months} currency={currency} onPick={onPick} active={active} />
    </ChartTouchArea>
  );
}

/** Reports the month the line's tooltip is on: while hovered, or while a touch is inspecting. */
function ActiveMonth({onChange}: {onChange: (index: number | null) => void}) {
  const {touch, inspecting} = useChartTouchState();
  const label = Number(useActiveTooltipLabel());
  const shown = useIsTooltipActive();
  const index = (touch ? inspecting : shown) && Number.isInteger(label) ? label : null;
  useEffect(() => onChange(index), [index, onChange]);
  return null;
}

/** Month-end balance as one line. Months sit at slot centres, like the bars below. */
function BalanceChart({
  months,
  currency,
  onPick,
  onActive,
}: {
  months: MonthPoint[];
  currency: string | null;
  onPick: (month: string) => void;
  onActive: (index: number | null) => void;
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
    // Beside the details it fills their height (12rem to 40rem), so neither column leaves a gap below it.
    <div
      ref={plotRef}
      className='flex min-h-56 flex-1 flex-col sm:min-h-64 @[60rem]:max-h-[40rem] @[60rem]:min-h-48'
    >
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
          <ActiveMonth onChange={onActive} />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

/** The line's cursor: the active month's whole x slot, behind the grid and line as the bar below sits on its mark. */
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

/** The chart area around a bar, whose line shows the readout for the bar's month. */
const areaOf = (bar: Element) => bar.closest('[data-slot="chart-touch-area"]');

/** Shows the line's readout for the month of `bar`, which sits on that month's x slot. */
function inspectBar(bar: Element) {
  const box = bar.getBoundingClientRect();
  inspectChartAt(areaOf(bar), box.left + box.width / 2);
}

/**
 * What was kept each month, on the same slots as the line above: up is kept, down is more out than in. Hovering or
 * focusing a bar shows the line's readout for its month, so both charts mark one month and give one answer.
 */
function KeptStrip({
  months,
  currency,
  onPick,
  active,
}: {
  months: MonthPoint[];
  currency: string | null;
  onPick: (month: string) => void;
  active: number | null;
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
        </span>
      </p>
      {/* Margins, not padding, so leaving the bars for the gutters ends the inspection. Moving bar to bar keeps it. */}
      <ol
        className='flex h-24'
        style={{marginLeft: Y_WIDTH, marginRight: RIGHT}}
        aria-label='Kept each month'
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') endChartInspection(areaOf(event.currentTarget));
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            endChartInspection(areaOf(event.currentTarget));
        }}
      >
        {months.map((point, index) => {
          const up = point.kept >= 0;
          const label = `${formatMonth(point.month, 'MMMM yyyy')}${point.complete ? '' : ' so far'}: kept ${signed(point.kept, currency)}`;
          return (
            <li key={point.month} className='relative min-w-0 flex-1'>
              <button
                type='button'
                data-active={index === active || undefined}
                onClick={() => onPick(point.month)}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') inspectBar(event.currentTarget);
                }}
                onFocus={(event) => {
                  if (event.currentTarget.matches(':focus-visible'))
                    inspectBar(event.currentTarget);
                }}
                aria-label={label}
                className={cn(
                  'group absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-active:bg-accent',
                  POINTER,
                )}
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
