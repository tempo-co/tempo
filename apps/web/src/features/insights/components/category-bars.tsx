import {useLayoutEffect, useRef, useState} from 'react';

import {axisFormatter, axisTicks} from '@/features/dashboard/utils/chart-axis';
import {wholeCents} from '@/features/dashboard/utils/format';
import {cn} from '@/utils/cn';

import type {CategoryBar} from '../utils/category-figures';

/** The bars' height; the ticks sit below it. */
const PLOT = 'h-40';
/** About the width of a caption figure's character, in px, to tell whether labels fit their column. */
const CAPTION_CHAR = 6.5;
/** The narrowest bar that is a link of its own. */
const TARGET = 44;

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
 * A category's spending per month (or per year over a long period) on one fixed scale with round gridlines, and a
 * dashed line at a usual month. A part period is drawn lighter and called "so far". Each bar opens its month, or
 * switches the period to its year.
 */
export function CategoryBars({
  bars,
  usual,
  currency,
  onOpen,
}: {
  bars: CategoryBar[];
  /** Cents in a usual month; no line without it. */
  usual: number | null;
  currency: string | null;
  onOpen: (bar: CategoryBar) => void;
}) {
  const {ref, width} = useWidth();
  const axis = axisFormatter(currency);
  const ticks = axisTicks(0, Math.max(0, usual ?? 0, ...bars.map((bar) => bar.cents)));
  const top = ticks[ticks.length - 1] * 100;
  const height = (cents: number) => `${Math.max(0, (cents / top) * 100)}%`;
  const column = width / bars.length;
  // Every nth tick, so the longest one fits; a bar opens only while it is a full target.
  const step = Math.max(
    1,
    Math.ceil((Math.max(...bars.map((bar) => bar.tick.length)) * CAPTION_CHAR + 4) / (column || 1)),
  );
  const linked = column >= TARGET;
  const partial = bars.filter((bar) => !bar.complete);
  const unit = bars[0].unit;

  return (
    <div className='grid gap-3'>
      <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-2'>
        <div aria-hidden='true' className='relative mb-5'>
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
          <div aria-hidden='true' className={cn('absolute inset-x-0 top-0', PLOT)}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className='absolute inset-x-0 border-t'
                style={{bottom: height(tick * 100)}}
              />
            ))}
          </div>
          <ol
            aria-label={`Spent per ${unit}, ${bars[0].name} to ${bars[bars.length - 1].name}`}
            className='relative flex'
          >
            {bars.map((bar, index) => {
              const label = `${bar.name}${bar.complete ? '' : ' so far'}: ${wholeCents(bar.cents, currency)}`;
              const body = (
                <>
                  <span
                    aria-hidden='true'
                    className={cn(
                      'flex items-end justify-center group-hover:bg-muted/60',
                      PLOT,
                      !bar.complete && 'opacity-50',
                    )}
                  >
                    <span
                      className='w-3/5 max-w-6 rounded-t-sm bg-chart-primary'
                      style={{height: height(bar.cents)}}
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
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                          return;
                        event.preventDefault();
                        onOpen(bar);
                      }}
                      aria-label={label}
                      className='group flex flex-col items-stretch rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                    >
                      {body}
                    </a>
                  ) : (
                    <div className='flex flex-col items-stretch'>
                      <span className='sr-only'>{label}</span>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {usual !== null && usual > 0 && (
            <div
              aria-hidden='true'
              className={cn('pointer-events-none absolute inset-x-0 top-0', PLOT)}
            >
              <span
                data-mark='usual'
                className='absolute inset-x-0 border-t-2 border-dashed border-foreground'
                style={{bottom: height(usual)}}
              />
            </div>
          )}
        </div>
      </div>
      <ul className='flex flex-wrap gap-x-4 gap-y-1 text-body-small text-muted-foreground'>
        {usual !== null && usual > 0 && (
          <li className='flex items-center gap-1.5'>
            <span aria-hidden='true' className='w-4 border-t-2 border-dashed border-foreground' />A
            usual month
          </li>
        )}
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
