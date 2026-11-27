import {useId} from 'react';

/** The chart's drawing box; it stretches to the card's width, and strokes keep their width. */
const WIDTH = 600;
const HEIGHT = 160;

/**
 * This month's spending added up day by day, as a line over its days so far, against the usual pace as a dashed line
 * over the whole month. The days after the last covered day, and the days before it no data covers, are hatched: no
 * data has come in for them, which is not the same as no spending.
 */
export function PaceChart({
  daysInMonth,
  spent,
  uncovered,
  usual,
  label,
}: {
  daysInMonth: number;
  /** Cumulative cents for each day of the month through the last covered day, from the 1st. */
  spent: number[];
  /** Runs of those days no data covers, as days of the month. */
  uncovered: Array<{from: number; to: number}>;
  /** Cumulative usual cents for every day of the month; null without a usual pace. */
  usual: number[] | null;
  /** What the chart shows, for screen readers. */
  label: string;
}) {
  const hatchId = useId();
  // Refunds can bring the month below zero, so the scale runs from the lowest point, never above zero.
  const top = Math.max(1, ...spent, ...(usual ?? [])) * 1.08;
  const bottom = Math.min(0, ...spent, ...(usual ?? []));
  const x = (day: number) => ((day - 1) / Math.max(1, daysInMonth - 1)) * WIDTH;
  const y = (cents: number) => HEIGHT - ((cents - bottom) / (top - bottom)) * (HEIGHT - 8) - 2;
  const points = (series: number[]) =>
    series.map((cents, index) => `${x(index + 1).toFixed(1)},${y(cents).toFixed(1)}`).join(' ');
  const covered = spent.length;
  const last = spent[covered - 1] as number | undefined;
  // The hatch starts where the line stops: day 1 when no day is covered yet.
  const gapFrom = covered === 0 ? 0 : x(covered);

  return (
    <div className='relative h-40'>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio='none'
        role='img'
        aria-label={label}
        className='block size-full overflow-visible'
      >
        <defs>
          <pattern
            id={hatchId}
            width='6'
            height='6'
            patternUnits='userSpaceOnUse'
            patternTransform='rotate(45)'
          >
            <line x1='0' y1='0' x2='0' y2='6' stroke='var(--color-input)' strokeWidth='1.5' />
          </pattern>
        </defs>
        <line
          x1='0'
          x2={WIDTH}
          y1={HEIGHT - 1}
          y2={HEIGHT - 1}
          stroke='var(--color-border)'
          vectorEffect='non-scaling-stroke'
        />
        {covered < daysInMonth && (
          <rect
            data-testid='pace-not-covered'
            x={gapFrom}
            y='0'
            width={WIDTH - gapFrom}
            height={HEIGHT}
            fill={`url(#${hatchId})`}
          />
        )}
        {uncovered.map(({from, to}) => (
          // From the covered day before the run to the covered day after it, where the line runs on.
          <rect
            key={from}
            data-testid='pace-not-covered'
            x={x(Math.max(1, from - 1))}
            y='0'
            width={x(Math.min(covered, to + 1)) - x(Math.max(1, from - 1))}
            height={HEIGHT}
            fill={`url(#${hatchId})`}
          />
        ))}
        {usual && (
          <polyline
            data-testid='pace-usual'
            points={points(usual)}
            fill='none'
            stroke='var(--color-chart-secondary-edge)'
            strokeWidth='2'
            strokeDasharray='5 4'
            vectorEffect='non-scaling-stroke'
          />
        )}
        {covered > 0 && (
          <>
            <polygon
              points={`${x(1)},${HEIGHT} ${points(spent)} ${x(covered)},${HEIGHT}`}
              fill='var(--color-chart-primary)'
              opacity='0.06'
            />
            <polyline
              data-testid='pace-spent'
              points={points(spent)}
              fill='none'
              stroke='var(--color-chart-primary)'
              strokeWidth='2.5'
              strokeLinejoin='round'
              vectorEffect='non-scaling-stroke'
            />
          </>
        )}
      </svg>
      {last !== undefined && (
        <span
          aria-hidden='true'
          className='absolute size-2.5 -translate-1/2 rounded-full bg-chart-primary ring-2 ring-card'
          style={{left: `${(x(covered) / WIDTH) * 100}%`, top: `${(y(last) / HEIGHT) * 100}%`}}
        />
      )}
    </div>
  );
}
