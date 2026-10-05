import {Link} from '@tanstack/react-router';

import {Card} from '@/components/ui/card';
import {BANK_TRANSACTION_UNCATEGORIZED} from '@/features/banking/types/bank-transaction';
import {BANK_TRANSACTION_CATEGORY_META} from '@/features/banking/utils/bank-transaction-category-meta';
import {cn} from '@/utils/cn';

import type {
  BankTransactionSummary,
  BankTransactionSummaryCategory,
} from '../types/bank-transaction-summary';
import {categoryDrill} from '../utils/drill-links';
import {formatMoney, toCents} from '../utils/money';
import {monthDates} from '../utils/month';

type CategoryBreakdownProps = {
  summary: BankTransactionSummary;
  isCurrentMonth: boolean;
};

/** Spending categories share a scale; the tick marks each category's baseline average. */
export function CategoryBreakdown({summary, isCurrentMonth}: CategoryBreakdownProps) {
  const {categories, baseCurrency, through} = summary;
  const {from} = monthDates(summary.month);
  const hasMissing = summary.excluded.missingBaseAmount > 0;
  // The API lists REFUND last; a positive refund bucket ranks with the other spending here.
  const spending = categories
    .filter((row) => toCents(row.spending) > 0)
    .sort(
      (a, b) => toCents(b.spending) - toCents(a.spending) || a.category.localeCompare(b.category),
    );
  const visible = spending.slice(0, 6);
  const remaining = spending.slice(6);
  const refund = categories.find((row) => row.category === 'REFUND' && toCents(row.spending) < 0);
  const scale = Math.max(
    1,
    ...visible.flatMap((row) => [toCents(row.spending), toCents(row.baselineAverage ?? '0.00')]),
  );

  return (
    <Card className='grid min-w-0 gap-6 p-5 sm:p-6' data-testid='category-breakdown'>
      <div>
        <h2 className='text-base font-semibold'>Where it went</h2>
        {summary.baseline.months.length > 0 && (
          <p className='mt-1 text-xs text-muted-foreground'>
            {isCurrentMonth
              ? 'Compared with usual by this day of the month.'
              : 'Compared with usual for a full month.'}
          </p>
        )}
      </div>
      {visible.length === 0 && !refund && (
        <p className='text-sm text-muted-foreground'>No spending this month.</p>
      )}
      <div className='grid gap-5'>
        {visible.map((row) => {
          const meta =
            row.category === BANK_TRANSACTION_UNCATEGORIZED
              ? null
              : BANK_TRANSACTION_CATEGORY_META[row.category];
          const label = meta?.label ?? 'Uncategorized';
          const usual = row.baselineAverage === null ? null : toCents(row.baselineAverage);
          const spent = toCents(row.spending);
          const comparison = categoryComparison(row, baseCurrency);
          return (
            <Link
              key={row.category}
              to='/bank-transactions'
              search={categoryDrill(row.category, from, through, hasMissing)}
              className='group block outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring'
            >
              <div className='flex items-baseline justify-between gap-3 text-sm'>
                <span className='min-w-0 group-hover:underline'>{label}</span>
                <span className='shrink-0 font-mono tabular-nums'>
                  {formatMoney(row.spending, baseCurrency)}
                </span>
              </div>
              <div
                className={cn(
                  'relative mt-2 h-1.5 rounded-full',
                  meta?.colorClassName ?? 'bg-muted text-muted-foreground',
                )}
              >
                <span
                  aria-hidden='true'
                  className='absolute inset-y-0 left-0 rounded-full bg-current'
                  style={{width: `${(spent / scale) * 100}%`}}
                />
                {usual !== null && (
                  <span
                    role='img'
                    aria-label={`Usual spending: ${formatMoney(row.baselineAverage!, baseCurrency)}`}
                    className='absolute -top-1 h-3.5 w-px -translate-x-1/2 bg-foreground/70'
                    style={{left: `${(Math.max(0, usual) / scale) * 100}%`}}
                  />
                )}
              </div>
              <p className='mt-1.5 text-xs text-muted-foreground'>
                {row.count} {row.count === 1 ? 'transaction' : 'transactions'}
                {comparison && ` · ${comparison}`}
              </p>
            </Link>
          );
        })}
        {remaining.length > 0 && (
          <Link
            to='/bank-transactions'
            search={categoryDrill(
              remaining.map((row) => row.category),
              from,
              through,
              hasMissing,
            )}
            className='w-fit text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
          >
            {remaining.length} more {remaining.length === 1 ? 'category' : 'categories'}{' '}
            <span aria-hidden='true'>→</span>
          </Link>
        )}
        {refund && (
          <Link
            to='/bank-transactions'
            search={categoryDrill('REFUND', from, through, hasMissing)}
            className='border-t pt-4 text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
          >
            <div className='flex items-baseline justify-between gap-3'>
              <span>Refunds (subtracted)</span>
              <span className='shrink-0 font-mono tabular-nums'>
                {formatMoney(refund.spending, baseCurrency)}
              </span>
            </div>
            <p className='mt-1 text-xs text-muted-foreground'>
              {refund.count} {refund.count === 1 ? 'transaction' : 'transactions'}
            </p>
          </Link>
        )}
      </div>
    </Card>
  );
}

function categoryComparison(row: BankTransactionSummaryCategory, currency: string | null) {
  if (row.baselineAverage === null) return null;
  const usual = toCents(row.baselineAverage);
  if (usual < 2000) return `usually ${formatMoney(row.baselineAverage, currency)}`;
  const difference = toCents(row.spending) - usual;
  if (Math.abs(difference) * 100 < usual * 25) return 'about usual';
  return `${difference > 0 ? '+' : '−'}${Math.round((Math.abs(difference) / usual) * 100)}%`;
}
