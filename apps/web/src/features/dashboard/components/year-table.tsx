import {Link} from '@tanstack/react-router';
import {ChevronRight} from 'lucide-react';
import {Fragment, useState} from 'react';

import {Card} from '@/components/ui/card';
import {cn} from '@/utils/cn';

import {pct, signed, wholeCents} from '../utils/format';
import {formatMonth} from '../utils/month';
import type {MonthPoint, Overview, YearRow} from '../utils/overview';
import {EventChips} from './event-line';

/** Years newest first; each opens into its months. Columns drop away on narrow screens, in that order. */
export function YearTable({overview}: {overview: Overview}) {
  const [open, setOpen] = useState<string | null>(
    overview.years[overview.years.length - 1]?.year ?? null,
  );
  const currency = overview.currency;
  const years = [...overview.years].reverse();
  const maxFlow = Math.max(1, ...overview.years.map((y) => Math.max(y.income, y.spending)));
  return (
    <Card role='region' aria-label='Year by year' className='min-w-0 overflow-hidden'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b text-left text-label text-muted-foreground [&>th]:px-2 [&>th]:py-2.5 [&>th]:font-medium sm:[&>th]:px-3'>
            <th className='pl-4 sm:pl-5'>Year</th>
            <th className='text-right max-[34rem]:hidden'>In</th>
            <th className='text-right max-[34rem]:hidden'>Out</th>
            <th className='text-right'>Kept</th>
            <th className='text-right'>Balance</th>
            <th className='max-[60rem]:hidden'>One-off payments</th>
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
    </Card>
  );
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
      <span aria-hidden='true' className='mt-1 ml-auto block h-1 w-24 bg-muted'>
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
    <tr className={cn('border-b align-middle', open && 'bg-accent/40')}>
      <td className='py-2 pr-1 pl-1 sm:pr-3 sm:pl-2'>
        <button
          type='button'
          aria-expanded={open}
          onClick={onToggle}
          className='flex min-h-11 items-center gap-1.5 px-1 text-left font-semibold focus-visible:outline-2 focus-visible:outline-ring'
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
      <td className='py-2 pr-4 pl-2 text-right sm:px-3'>
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
      <td className='px-3 py-2 max-[60rem]:hidden'>
        <EventChips events={row.events} currency={currency} />
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
  const line = (
    <tr
      className={cn(
        'border-b border-border/60 bg-muted/20',
        point.events.length > 0 && 'max-[60rem]:border-b-0',
      )}
    >
      <td className='py-0.5 pr-1 pl-7 sm:pr-3 sm:pl-12'>
        <Link
          to='/'
          search={(prev) => ({...prev, month: point.month})}
          className='inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-8'
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
      <td className='py-0.5 pr-4 pl-2 text-right numeric whitespace-nowrap sm:px-3'>
        {wholeCents(point.balance, currency)}
      </td>
      <td className='px-3 py-0.5 max-[60rem]:hidden'>
        <EventChips events={point.events} currency={currency} />
      </td>
    </tr>
  );
  if (point.events.length === 0) return line;
  // Without the one-offs column, a month's one-offs get a line of their own under it, the table's full width.
  return (
    <>
      {line}
      <tr className='border-b border-border/60 bg-muted/20 min-[60rem]:hidden'>
        <td colSpan={6} className='pt-0 pr-4 pb-1 pl-7 sm:pl-12'>
          <EventChips events={point.events} currency={currency} />
        </td>
      </tr>
    </>
  );
}
