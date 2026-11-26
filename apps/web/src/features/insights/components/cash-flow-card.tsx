import {ChartColumn, Table2} from 'lucide-react';
import {type ReactNode, useLayoutEffect, useRef, useState} from 'react';

import {Card} from '@/components/ui/card';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {TextBone} from '@/features/dashboard/components/loading';
import {axisFormatter, axisTicks} from '@/features/dashboard/utils/chart-axis';
import {pct, signed, wholeCents} from '@/features/dashboard/utils/format';
import {cn} from '@/utils/cn';

/** One pair of bars: a month, or a year over a long period. */
export type FlowBar = {
  key: string;
  /** Under the pair. */
  tick: string;
  /** What the pair is, in words: "October 2026". */
  name: string;
  income: number;
  spending: number;
  complete: boolean;
  href: string;
  /** Opens the pair in place of following `href`, for a year, which is a period of this page. */
  onOpen?: () => void;
};

/** The bars' height; the kept figures sit above it and the ticks below. */
const PLOT = 'h-40';
/** About the width of a caption figure's character, in px, to tell whether labels fit their column. */
const CAPTION_CHAR = 6.5;
/** The narrowest pair that is a link of its own; narrower, the months open from the table. */
const TARGET = 44;

/**
 * In, Out and Kept over the period, then the money in and out per month (or per year over a long period), each pair
 * with what was kept above it. The Chart / Table switch swaps the bars for the year and heat tables.
 */
export function CashFlowCard({
  figures,
  currency,
  bars,
  unit,
  view,
  onViewChange,
}: {
  figures: {income: number; spending: number; kept: number} | null;
  currency: string | null;
  bars: FlowBar[] | null;
  unit: 'month' | 'year';
  view: 'chart' | 'table';
  onViewChange: (view: 'chart' | 'table') => void;
}) {
  return (
    <Card
      role='region'
      aria-label='Cash flow'
      aria-busy={!figures || undefined}
      className='grid min-w-0 gap-4 p-4'
    >
      <header className='flex items-center justify-between gap-4'>
        <h2 className='text-card-title'>Cash flow</h2>
        {/* Overhangs the title row so the title sits where it does on every other card. */}
        <Tabs
          value={view}
          onValueChange={(next) => onViewChange(next === 'table' ? 'table' : 'chart')}
          className='-my-1.5 max-sm:-my-2.5 pointer-coarse:-my-2.5'
        >
          <TabsList aria-label='Cash flow view' className='max-sm:h-12 pointer-coarse:h-12'>
            <TabsTrigger value='chart'>
              <ChartColumn aria-hidden className='size-4' />
              Chart
            </TabsTrigger>
            <TabsTrigger value='table'>
              <Table2 aria-hidden className='size-4' />
              Table
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </header>
      <dl className='grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-3'>
        <Figure label='In'>
          {figures && (
            <span className={cn(figures.income > 0 && 'text-success')}>
              {figures.income > 0 ? signed(figures.income, currency) : wholeCents(0, currency)}
            </span>
          )}
        </Figure>
        <Figure label='Out'>{figures && wholeCents(figures.spending, currency)}</Figure>
        <Figure
          label='Kept'
          note={
            figures && figures.income > 0 && <>{pct(figures.kept / figures.income)} of income</>
          }
        >
          {figures && signed(figures.kept, currency)}
        </Figure>
      </dl>
      {view === 'chart' &&
        (bars ? (
          bars.length > 1 && <PairedBars bars={bars} unit={unit} currency={currency} />
        ) : (
          <div aria-hidden='true' className='h-52 animate-pulse rounded-md bg-muted' />
        ))}
    </Card>
  );
}

function Figure({label, note, children}: {label: string; note?: ReactNode; children: ReactNode}) {
  return (
    <div data-testid='cash-flow-figure' className='min-w-0'>
      <dt className='text-label text-muted-foreground'>{label}</dt>
      <dd className='numeric text-xl font-semibold tracking-tight whitespace-nowrap max-sm:text-lg'>
        {children ?? <TextBone className='w-[4em]' />}
      </dd>
      {note && <dd className='text-body-small text-muted-foreground'>{note}</dd>}
    </div>
  );
}

/** The plot's width in px, measured before paint and on every resize. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  return {ref, width};
}

/**
 * Paired bars on one fixed scale with round gridlines: In in green, Out in ink. A part month (the running one, or one
 * cut short where history starts) is drawn lighter and called "so far". Each pair opens its month or year.
 */
function PairedBars({
  bars,
  unit,
  currency,
}: {
  bars: FlowBar[];
  unit: 'month' | 'year';
  currency: string | null;
}) {
  const {ref, width} = useWidth();
  const axis = axisFormatter(currency);
  const ticks = axisTicks(0, Math.max(0, ...bars.flatMap((bar) => [bar.income, bar.spending])));
  const top = ticks[ticks.length - 1] * 100;
  const height = (cents: number) => `${Math.max(0, (cents / top) * 100)}%`;
  const keptLabels = bars.map((bar) => signed(bar.income - bar.spending, currency));
  // The kept figures show only while the longest fits its column.
  const showKept =
    width > 0 &&
    width / bars.length >= Math.max(...keptLabels.map((label) => label.length)) * CAPTION_CHAR + 4;
  const partial = bars.filter((bar) => !bar.complete);
  const column = width / bars.length;
  // Every nth tick, so the longest one fits; a pair opens its month only while it is a full target.
  const step = Math.max(
    1,
    Math.ceil((Math.max(...bars.map((bar) => bar.tick.length)) * CAPTION_CHAR + 4) / (column || 1)),
  );
  const linked = column >= TARGET;

  return (
    <div className='grid gap-3'>
      <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-2'>
        {/* The y axis: round steps on the bars' scale, level with their gridlines. */}
        <div aria-hidden='true' className='relative mt-5 mb-5'>
          {/* Sizes the column to the widest label; the labels drawn sit level with their gridlines. */}
          <div className='invisible flex h-0 flex-col overflow-hidden'>
            {ticks.map((tick) => (
              <span key={tick} className='numeric text-caption'>
                {axis.format(tick)}
              </span>
            ))}
          </div>
          <div className={cn('relative', PLOT)}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className='absolute right-0 translate-y-1/2 numeric text-caption text-muted-foreground'
                style={{bottom: height(tick * 100)}}
              >
                {axis.format(tick)}
              </span>
            ))}
          </div>
        </div>
        <div ref={ref} className='relative min-w-0'>
          <div aria-hidden='true' className={cn('absolute inset-x-0 top-5', PLOT)}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className='absolute inset-x-0 border-t'
                style={{bottom: height(tick * 100)}}
              />
            ))}
          </div>
          <ol
            aria-label={`In and out per ${unit}, ${bars[0].name} to ${bars[bars.length - 1].name}`}
            className='relative flex'
          >
            {bars.map((bar, index) => {
              const label = `${bar.name}${bar.complete ? '' : ' so far'}: in ${wholeCents(bar.income, currency)}, out ${wholeCents(bar.spending, currency)}, kept ${keptLabels[index]}`;
              const pair = (
                <>
                  {showKept ? (
                    <span
                      aria-hidden='true'
                      className={cn(
                        'h-4 truncate text-center numeric text-caption text-muted-foreground',
                        bar.income - bar.spending < 0 && 'text-foreground',
                      )}
                    >
                      {keptLabels[index]}
                    </span>
                  ) : (
                    <span aria-hidden='true' className='h-4' />
                  )}
                  <span
                    aria-hidden='true'
                    className={cn(
                      'mt-1 flex items-end justify-center gap-px group-hover:bg-muted/60',
                      PLOT,
                      !bar.complete && 'opacity-50',
                    )}
                  >
                    <span
                      className='w-2/5 max-w-4.5 rounded-t-sm bg-success'
                      style={{height: height(bar.income)}}
                    />
                    <span
                      className='w-2/5 max-w-4.5 rounded-t-sm bg-chart-primary'
                      style={{height: height(bar.spending)}}
                    />
                  </span>
                  <span
                    aria-hidden='true'
                    className='mt-1 h-4 overflow-visible text-center text-caption whitespace-nowrap text-muted-foreground'
                  >
                    {index % step === (bars.length - 1) % step ? bar.tick : ''}
                  </span>
                </>
              );
              return (
                <li key={bar.key} className='min-w-0 flex-1'>
                  {linked ? (
                    <a
                      href={bar.href}
                      onClick={(event) => {
                        if (!bar.onOpen) return;
                        event.preventDefault();
                        bar.onOpen();
                      }}
                      aria-label={label}
                      className='group flex flex-col items-stretch rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                    >
                      {pair}
                    </a>
                  ) : (
                    <div className='flex flex-col items-stretch'>
                      <span className='sr-only'>{label}</span>
                      {pair}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <ul className='flex flex-wrap gap-x-4 gap-y-1 text-body-small text-muted-foreground'>
        <li className='flex items-center gap-1.5'>
          <span aria-hidden='true' className='size-2.5 rounded-xs bg-success' />
          In
        </li>
        <li className='flex items-center gap-1.5'>
          <span aria-hidden='true' className='size-2.5 rounded-xs bg-chart-primary' />
          Out
        </li>
        {showKept && <li>Above each pair: kept</li>}
        {partial.map((bar) => (
          <li key={bar.key} className='flex items-center gap-1.5'>
            <span aria-hidden='true' className='size-2.5 rounded-xs bg-chart-primary opacity-50' />
            {bar.name} so far
          </li>
        ))}
      </ul>
    </div>
  );
}
