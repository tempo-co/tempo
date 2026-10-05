import {Link} from '@tanstack/react-router';
import {format} from 'date-fns';

import {Card} from '@/components/ui/card';
import {cn} from '@/utils/cn';

import type {BankTransactionSummary} from '../types/bank-transaction-summary';
import {excludedDrill, parseCalendarDate, periodDrill} from '../utils/drill-links';
import {formatMoney, toCents} from '../utils/money';
import {formatMonth, monthDates} from '../utils/month';
import {SpendingPaceChart} from './spending-pace-chart';

const BASELINE_MONTHS = 3;

const linkClassName =
  'underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring';

type SpendingSummaryCardProps = {
  summary: BankTransactionSummary;
  isCurrentMonth: boolean;
};

/** The month's spending headline, how it compares with earlier months, and its pace. */
export function SpendingSummaryCard({summary, isCurrentMonth}: SpendingSummaryCardProps) {
  const {from} = monthDates(summary.month);
  const {through, baseCurrency, totals} = summary;
  const throughDate = parseCalendarDate(through);
  const monthName = formatMonth(summary.month);
  const period = !isCurrentMonth
    ? `spent in ${monthName}`
    : throughDate.getDate() === 1
      ? `spent on 1 ${format(throughDate, 'MMMM')}`
      : `spent 1–${format(throughDate, 'd MMMM')}`;

  return (
    <Card className='min-w-0 p-5 sm:p-6' data-testid='spending-summary'>
      <div className='flex flex-wrap items-start justify-between gap-x-6 gap-y-3'>
        <div>
          <Link
            to='/bank-transactions'
            search={periodDrill(from, through)}
            className={cn(
              'font-mono text-[1.75rem] leading-tight font-semibold tracking-tight tabular-nums',
              linkClassName,
            )}
          >
            {formatMoney(totals.spending, baseCurrency)}
          </Link>
          <p className='mt-1 text-sm text-muted-foreground'>{period}</p>
        </div>
        <SpendingComparison summary={summary} />
      </div>
      <dl className='mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm'>
        <div className='flex items-baseline gap-1.5'>
          <dt className='text-muted-foreground'>Income</dt>
          <dd>
            <Link
              to='/bank-transactions'
              search={periodDrill(from, through)}
              className={cn('font-mono tabular-nums', linkClassName)}
            >
              {formatMoney(totals.income, baseCurrency)}
            </Link>
          </dd>
        </div>
        <div className='flex items-baseline gap-1.5'>
          <dt className='text-muted-foreground'>Net</dt>
          <dd className={cn('font-mono tabular-nums', toCents(totals.net) > 0 && 'text-success')}>
            {formatMoney(totals.net, baseCurrency)}
          </dd>
        </div>
        <NotInTotals summary={summary} from={from} />
      </dl>
      <SpendingPaceChart summary={summary} isCurrentMonth={isCurrentMonth} />
    </Card>
  );
}

function SpendingComparison({summary}: Pick<SpendingSummaryCardProps, 'summary'>) {
  const {baseline, baseCurrency} = summary;
  if (baseline.spendingByThrough === null || baseline.months.length === 0) {
    return (
      <p className='text-sm text-muted-foreground sm:pt-2 sm:text-right'>
        No earlier months to compare with yet.
      </p>
    );
  }

  const throughDate = parseCalendarDate(summary.through);
  const spent = toCents(summary.totals.spending);
  const usual = toCents(baseline.spendingByThrough);
  const difference = spent - usual;
  const comparison =
    difference === 0
      ? 'The same as usual'
      : `${formatMoney(Math.abs(difference) / 100, baseCurrency)} ${difference > 0 ? 'more' : 'less'} than usual`;

  const range = baseline.daily[throughDate.getDate() - 1];
  const isAboveRange = range?.high != null && spent > toCents(range.high);
  const verdict =
    range?.low == null || range.high == null
      ? null
      : isAboveRange
        ? 'above range'
        : spent < toCents(range.low)
          ? 'below range'
          : 'within range';
  const history =
    baseline.months.length < BASELINE_MONTHS
      ? `only ${baseline.months.length} ${baseline.months.length === 1 ? 'month' : 'months'} of history`
      : null;
  const details = [
    `Usual by the ${format(throughDate, 'do')}: ${formatMoney(baseline.spendingByThrough, baseCurrency)}`,
    verdict,
    history,
  ].filter(Boolean);

  return (
    <div className='text-sm sm:pt-1 sm:text-right' data-testid='spending-comparison'>
      <p className={cn('font-medium', isAboveRange && 'text-primary')}>{comparison}</p>
      <p className='mt-0.5 text-xs text-muted-foreground'>{details.join(' · ')}</p>
    </div>
  );
}

/** Rows the totals leave out, each linking to exactly the rows its count covers. */
function NotInTotals({summary, from}: {summary: BankTransactionSummary; from: string}) {
  const {excluded, through, baseCurrency} = summary;
  if (excluded.unknownDirection === 0 && excluded.missingBaseAmount === 0) return null;

  return (
    <div className='flex flex-wrap items-baseline gap-x-1.5'>
      <dt className='text-muted-foreground'>Not in totals</dt>
      {excluded.missingBaseAmount > 0 && (
        <dd>
          <Link
            to='/bank-transactions'
            search={excludedDrill('missingBaseAmount', from, through)}
            className={linkClassName}
          >
            {excluded.missingBaseAmount} not converted
            {baseCurrency ? ` to ${baseCurrency}` : ' yet'}
          </Link>
        </dd>
      )}
      {excluded.unknownDirection > 0 && (
        <dd>
          {excluded.missingBaseAmount > 0 && <span aria-hidden='true'>· </span>}
          <Link
            to='/bank-transactions'
            search={excludedDrill('unknownDirection', from, through)}
            className={linkClassName}
          >
            {excluded.unknownDirection} unknown direction
          </Link>
        </dd>
      )}
    </div>
  );
}
