import {Link} from '@tanstack/react-router';
import type {CSSProperties} from 'react';

import {Card} from '@/components/ui/card';
import {CategoryName} from '@/features/dashboard/components/category-name';
import {FIGURE_CHAR, figureColumnWidth, wholeCents} from '@/features/dashboard/utils/format';
import {cn} from '@/utils/cn';

import type {InsightsPeriodSearch} from '../types/insights-search';
import type {CategoryRow} from '../utils/period-figures';

/** The figure columns take the room their longest figure needs, so large amounts fit and the columns line up. */
const ROW =
  'grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2 @[34rem]:grid-cols-[minmax(0,1fr)_7rem_var(--month)_var(--total)]';

/**
 * Spending by category over the period, largest first: each row's last 12 months as a sparkline, a month on average
 * and the period's total. A row opens its category's page.
 */
export function CategoryList({
  rows,
  currency,
  search,
  periodLabel,
}: {
  rows: CategoryRow[];
  currency: string | null;
  /** The period the category's page opens on. */
  search: InsightsPeriodSearch;
  periodLabel: string;
}) {
  const widths = {
    '--month': figureColumnWidth(
      rows.map((row) => (row.perMonth === null ? '—' : wholeCents(row.perMonth, currency))),
      {perChar: FIGURE_CHAR, padding: 0.75, min: 4.5},
    ),
    '--total': figureColumnWidth(
      rows.map((row) => wholeCents(row.total, currency)),
      {perChar: FIGURE_CHAR, padding: 0.75, min: 4.5},
    ),
  } as CSSProperties;
  return (
    <Card
      role='region'
      aria-label='Categories'
      className='@container min-w-0 overflow-hidden'
      style={widths}
    >
      <header className='flex items-baseline justify-between gap-4 px-4 pt-4 pb-2'>
        <h2 className='text-card-title'>Categories</h2>
        <p className='text-body-small text-muted-foreground'>{periodLabel}</p>
      </header>
      {rows.length === 0 ? (
        <p className='px-4 pb-4 text-body-small text-muted-foreground'>
          No spending in this period.
        </p>
      ) : (
        <>
          <div
            aria-hidden='true'
            className={cn(ROW, 'min-h-8 border-b py-0 text-label text-muted-foreground')}
          >
            <span>Category</span>
            <span className='hidden @[34rem]:block'>Last 12 months</span>
            <span className='hidden text-right @[34rem]:block'>A month</span>
            <span className='text-right'>Total</span>
          </div>
          <ul className='divide-y divide-border/60 pb-1'>
            {rows.map((row) => (
              <li key={row.category}>
                <Link
                  to='/insights/categories/$category'
                  params={{category: row.category}}
                  search={search}
                  className={cn(
                    ROW,
                    'text-body hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  )}
                >
                  <CategoryName category={row.category} />
                  <Sparkline row={row} className='hidden @[34rem]:flex' />
                  <span className='hidden text-right numeric text-muted-foreground @[34rem]:block'>
                    {row.perMonth === null ? '—' : wholeCents(row.perMonth, currency)}
                  </span>
                  <span className='text-right numeric whitespace-nowrap'>
                    {wholeCents(row.total, currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** A bar a month on the row's own scale; the running month is lighter. */
function Sparkline({row, className}: {row: CategoryRow; className?: string}) {
  const highest = Math.max(1, ...row.spark.map((point) => point.cents));
  return (
    <span aria-hidden='true' className={cn('h-6 items-end gap-0.5', className)}>
      {row.spark.map((point) => (
        <span
          key={point.month}
          className={cn('flex-1 rounded-t-xs bg-chart-primary', !point.complete && 'opacity-50')}
          style={{height: `${Math.max(point.cents > 0 ? 8 : 0, (point.cents / highest) * 100)}%`}}
        />
      ))}
    </span>
  );
}
