import {Link, useNavigate} from '@tanstack/react-router';
import {ChevronRight} from 'lucide-react';
import {type CSSProperties, Fragment, useState} from 'react';

import {Card} from '@/components/ui/card';
import {cn} from '@/utils/cn';

import {pct, signed, wholeCents} from '../utils/format';
import {formatMonth} from '../utils/month';
import type {MonthPoint, Overview, YearRow} from '../utils/overview';
import {LoadingLabel, TextBone} from './loading';

/**
 * Years newest first; a click anywhere on a year opens it into its months. Columns drop away on narrow screens, and
 * the layout is fixed, so opening a year never moves a column.
 */
export function YearTable({overview}: {overview: Overview}) {
  const [open, setOpen] = useState<string | null>(
    overview.years[overview.years.length - 1]?.year ?? null,
  );
  const currency = overview.currency;
  const years = [...overview.years].reverse();
  const maxFlow = Math.max(1, ...overview.years.map((y) => Math.max(y.income, y.spending)));
  const months = overview.years.flatMap((row) => row.months);
  const widths = {
    income: fit(
      [...overview.years, ...months].map((row) => wholeCents(row.income, currency)),
      1.5,
    ),
    spending: fit(
      [...overview.years, ...months].map((row) => wholeCents(row.spending, currency)),
      1.5,
    ),
    kept: fit(
      [...overview.years, ...months].map((row) => signed(row.kept, currency)),
      1.5,
    ),
    balance: fit(
      [
        ...overview.years.flatMap((row) => [
          wholeCents(row.end, currency),
          row.end === null || row.start === null ? '' : signed(row.end - row.start, currency),
        ]),
        ...months.map((point) => wholeCents(point.balance, currency)),
      ],
      2,
    ),
  };
  return (
    <Card role='region' aria-label='Year by year' className='min-w-0 overflow-hidden'>
      {/* Scrolls rather than clips when amounts are too long for a phone. */}
      <div className='overflow-x-auto'>
        {/*
          The header's widths set every column, open year or not: each figure column is a fifth of the table, or as
          wide as its longest figure (months included), and the year takes the rest. Narrower than that, it scrolls.
        */}
        <table
          className='w-full min-w-(--narrow) table-fixed text-sm min-[34rem]:min-w-(--wide)'
          style={
            {
              '--narrow': `calc(${YEAR_MIN} + ${widths.kept} + ${widths.balance})`,
              '--wide': `calc(${YEAR_MIN} + ${widths.income} + ${widths.spending} + ${widths.kept} + ${widths.balance})`,
            } as CSSProperties
          }
        >
          <thead>
            {/* Each header has its column's padding, so headings and figures share one edge. */}
            <tr className='border-b text-left text-label text-muted-foreground [&>th]:py-2.5 [&>th]:font-medium'>
              <th className='pr-1 pl-2 sm:pr-3 sm:pl-3'>Year</th>
              <th
                className='px-3 text-right max-[34rem]:hidden'
                style={{width: share(widths.income)}}
              >
                In
              </th>
              <th
                className='px-3 text-right max-[34rem]:hidden'
                style={{width: share(widths.spending)}}
              >
                Out
              </th>
              <th className='px-2 text-right sm:px-3' style={{width: share(widths.kept)}}>
                Kept
              </th>
              <th
                className='pr-4 pl-2 text-right sm:pr-5 sm:pl-3'
                style={{width: share(widths.balance)}}
              >
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {years.map((row) => (
              <Fragment key={row.year}>
                <YearLine
                  row={row}
                  currency={currency}
                  maxFlow={maxFlow}
                  open={open === row.year}
                  onToggle={() => setOpen(open === row.year ? null : row.year)}
                />
                {open === row.year &&
                  [...row.months]
                    .reverse()
                    .map((point) => (
                      <MonthLine
                        key={point.month}
                        point={point}
                        currency={currency}
                        maxFlow={maxFlow / 12}
                      />
                    ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Month rows a loading table holds under its open year, about what a year in progress shows. */
const SKELETON_MONTHS = 6;

/** The table while the history loads: its header, the open year with some months, and the year before. */
export function YearTableSkeleton() {
  const year = (
    <tr className='border-b'>
      <td className='py-2 pr-1 pl-1 sm:pr-3 sm:pl-2'>
        <span className='flex min-h-11 items-center gap-1.5 px-1'>
          <ChevronRight aria-hidden='true' className='size-4 shrink-0 text-muted-foreground' />
          <TextBone className='w-[3em]' />
        </span>
      </td>
      {['max-[34rem]:hidden', 'max-[34rem]:hidden', '', ''].map((hidden, index) => (
        <td key={index} className={cn('px-3 py-2 text-right', hidden)}>
          <TextBone className='w-[5em]' />
        </td>
      ))}
    </tr>
  );
  return (
    <Card
      role='region'
      aria-label='Year by year'
      aria-busy='true'
      className='min-w-0 overflow-hidden'
    >
      <LoadingLabel>Loading year by year</LoadingLabel>
      <table className='w-full table-fixed text-sm'>
        <thead>
          <tr className='border-b text-left text-label text-muted-foreground [&>th]:py-2.5 [&>th]:font-medium'>
            <th className='pr-1 pl-2 sm:pr-3 sm:pl-3'>Year</th>
            <th className='w-1/5 px-3 text-right max-[34rem]:hidden'>In</th>
            <th className='w-1/5 px-3 text-right max-[34rem]:hidden'>Out</th>
            <th className='w-1/5 px-2 text-right sm:px-3'>Kept</th>
            <th className='w-1/5 pr-4 pl-2 text-right sm:pr-5 sm:pl-3'>Balance</th>
          </tr>
        </thead>
        <tbody aria-hidden='true'>
          {year}
          {Array.from({length: SKELETON_MONTHS}, (_, index) => (
            <tr key={index} className='border-b border-border/60 bg-muted/20'>
              <td className='py-0.5 pr-1 pl-7 sm:pr-3 sm:pl-12'>
                <span className='flex min-h-11 items-center sm:min-h-8'>
                  <TextBone className='w-[4.5em]' />
                </span>
              </td>
              {['max-[34rem]:hidden', 'max-[34rem]:hidden', '', ''].map((hidden, cell) => (
                <td key={cell} className={cn('px-3 py-0.5 text-right', hidden)}>
                  <TextBone className='w-[4em]' />
                </td>
              ))}
            </tr>
          ))}
          {year}
        </tbody>
      </table>
    </Card>
  );
}

/** The year column's least width: a month's name under the year's chevron. */
const YEAR_MIN = '7.5rem';

/** A figure column's width: a fifth of the table, or what its longest figure needs. */
const share = (fitted: string) => `max(20%, ${fitted})`;

/** A column width that fits the longest of `texts` in the table's figures, plus `padding` rem. */
function fit(texts: string[], padding: number) {
  const longest = Math.max(0, ...texts.map((text) => text.length));
  return `${Math.ceil((longest * 0.6 + padding) * 4) / 4}rem`;
}

function FlowCell({
  value,
  max,
  tone,
  currency,
  compact,
}: {
  value: number;
  max: number;
  tone: string;
  currency: string | null;
  compact?: boolean;
}) {
  return (
    <td
      className={cn('px-3 text-right align-middle max-[34rem]:hidden', compact ? 'py-0.5' : 'py-2')}
    >
      <span className='block numeric whitespace-nowrap'>{wholeCents(value, currency)}</span>
      <span aria-hidden='true' className='mt-1 ml-auto block h-1 w-full max-w-24 bg-muted'>
        <span
          className={cn('block h-full', tone)}
          style={{width: `${Math.min(100, (value / max) * 100)}%`}}
        />
      </span>
    </td>
  );
}

function YearLine({
  row,
  currency,
  maxFlow,
  open,
  onToggle,
}: {
  row: YearRow;
  currency: string | null;
  maxFlow: number;
  open: boolean;
  onToggle: () => void;
}) {
  const share = row.income > 0 ? row.kept / row.income : null;
  const change = row.end === null || row.start === null ? null : row.end - row.start;
  return (
    // The year's button is the row's keyboard and screen-reader control; a click anywhere else on the row toggles too.
    <tr
      onClick={onToggle}
      className={cn(
        'cursor-pointer border-b align-middle hover:bg-accent/50 has-[button:focus-visible]:outline-2 has-[button:focus-visible]:-outline-offset-2 has-[button:focus-visible]:outline-ring',
        open && 'bg-accent/40',
      )}
    >
      <td className='py-2 pr-1 pl-1 sm:pr-3 sm:pl-2'>
        <button
          type='button'
          aria-expanded={open}
          className='flex min-h-11 items-center gap-1.5 px-1 text-left font-semibold outline-none'
        >
          <ChevronRight
            aria-hidden='true'
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className='numeric'>
            {row.year}
            {!row.complete && (
              <span className='block text-xs font-normal text-muted-foreground'>so far</span>
            )}
          </span>
        </button>
      </td>
      <FlowCell value={row.income} max={maxFlow} tone='bg-success' currency={currency} />
      <FlowCell value={row.spending} max={maxFlow} tone='bg-chart-primary' currency={currency} />
      <td className='px-2 py-2 text-right sm:px-3'>
        <span
          className={cn(
            'block numeric font-semibold whitespace-nowrap',
            row.kept < 0 && 'text-warning',
          )}
        >
          {signed(row.kept, currency)}
        </span>
        {share !== null && (
          <span className='block numeric text-xs whitespace-nowrap text-muted-foreground'>
            {pct(share)}
            <span className='max-[25rem]:hidden'> of in</span>
          </span>
        )}
      </td>
      <td className='py-2 pr-4 pl-2 text-right sm:pr-5 sm:pl-3'>
        <span className='block numeric whitespace-nowrap'>{wholeCents(row.end, currency)}</span>
        {change !== null && (
          <span
            className={cn(
              'block numeric text-xs whitespace-nowrap',
              change >= 0 ? 'text-success' : 'text-warning',
            )}
          >
            {signed(change, currency)}
          </span>
        )}
      </td>
    </tr>
  );
}

function MonthLine({
  point,
  currency,
  maxFlow,
}: {
  point: MonthPoint;
  currency: string | null;
  maxFlow: number;
}) {
  const navigate = useNavigate();
  return (
    // The month's link is the row's keyboard and screen-reader control; a click anywhere else on the row opens it too.
    <tr
      onClick={(event) => {
        if ((event.target as Element).closest('a')) return;
        void navigate({to: '/', search: (prev) => ({...prev, month: point.month})});
      }}
      // Month rows already sit on a tint, so their hover is the full accent to show against it.
      className='cursor-pointer border-b border-border/60 bg-muted/20 hover:bg-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ring'
    >
      <td className='py-0.5 pr-1 pl-7 sm:pr-3 sm:pl-12'>
        <Link
          to='/'
          search={(prev) => ({...prev, month: point.month})}
          className='inline-flex min-h-11 min-w-11 items-center outline-none sm:min-h-8'
        >
          {formatMonth(point.month, 'MMMM')}
        </Link>
      </td>
      <FlowCell
        value={point.income}
        max={maxFlow}
        tone='bg-success/70'
        currency={currency}
        compact
      />
      <FlowCell
        value={point.spending}
        max={maxFlow}
        tone='bg-chart-primary/70'
        currency={currency}
        compact
      />
      <td
        className={cn(
          'px-2 py-0.5 text-right numeric whitespace-nowrap sm:px-3',
          point.kept < 0 && 'text-warning',
        )}
      >
        {signed(point.kept, currency)}
      </td>
      <td className='py-0.5 pr-4 pl-2 text-right numeric whitespace-nowrap sm:pr-5 sm:pl-3'>
        {wholeCents(point.balance, currency)}
      </td>
    </tr>
  );
}
