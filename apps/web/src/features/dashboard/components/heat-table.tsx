import {Link} from '@tanstack/react-router';
import type {BankTransactionBreakdownPeriod} from '@tempo/contracts';
import {format} from 'date-fns';
import {type ReactNode, useState} from 'react';

import {Card} from '@/components/ui/card';
import {useHasMissingBaseAmounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {cn} from '@/utils/cn';

import {categoryDrill, flowDrill, parseCalendarDate} from '../utils/drill-links';
import {categoryColor, categoryLabel, signedPct} from '../utils/format';
import {formatWholeMoney, toCents} from '../utils/money';
import {type MonthPoint, monthsCovered, partCents} from '../utils/overview';

type Period = BankTransactionBreakdownPeriod;

/** A year with fewer months of history than this is too thin for its monthly average to be shaded. */
const THIN_MONTHS = 3;
/** Rows under this share of all time fold into one "more" row... */
const FOLD_SHARE = 0.03;
/** ...keeping at least this many rows and at most this many. */
const MIN_ROWS = 3;
const MAX_ROWS = 8;

/**
 * Rows are categories (or sources), columns years, newest first. A cell is a month on average in that year, so a
 * part year compares fairly with a whole one. Each row is shaded against its own highest year; the first numeric
 * column is the change on the year before. Small rows fold into one "more" row that opens them. Every cell opens
 * its transactions.
 */
export function HeatTable({
  title,
  periods: oldestFirst,
  months,
  currency,
  kind,
}: {
  title: string;
  periods: Period[];
  months: MonthPoint[];
  currency: string | null;
  kind: 'category' | 'source';
}) {
  const [all, setAll] = useState(false);
  const missingBaseAmounts = useHasMissingBaseAmounts();
  const cover = new Map(oldestFirst.map((period) => [period.start, monthsCovered(period, months)]));
  // Newest year first, so the recent years are in view on a phone and older ones scroll in.
  const periods = [...oldestFirst].reverse().filter((period) => (cover.get(period.start) ?? 0) > 0);
  const keys = [...new Set(periods.flatMap((period) => period.parts.map((part) => part.key)))];
  if (keys.length === 0 || months.length === 0) return null;
  const thin = (period: Period) => (cover.get(period.start) ?? 0) < THIN_MONTHS;
  const cell = partCents;
  const monthly = (period: Period, cents: number) => cents / (cover.get(period.start) ?? 1);
  const allTime = new Map(
    keys.map((key) => [key, periods.reduce((sum, period) => sum + cell(period, key), 0)]),
  );
  keys.sort((a, b) => allTime.get(b)! - allTime.get(a)!);
  const grand = keys.reduce((sum, key) => sum + allTime.get(key)!, 0);
  const labels = new Map(
    periods.flatMap((period) => period.parts.map((part) => [part.key, part.label] as const)),
  );
  const nameOf = (key: string) =>
    kind === 'category' ? categoryLabel(key) : (labels.get(key) ?? key);
  const top = keys.filter(
    (key, index) =>
      index < MIN_ROWS || (index < MAX_ROWS && allTime.get(key)! >= grand * FOLD_SHARE),
  );
  const rest = keys.filter((key) => !top.includes(key));
  const shown = all ? keys : top;
  const [latest, previous] = periods;
  const yearOf = (period: Period) => period.start.slice(0, 4);
  const historyStart = `${months[0].month}-01`;
  const oldest = periods[periods.length - 1];
  const startNote =
    historyStart > oldest.start && `from ${format(parseCalendarDate(historyStart), 'MMM')}`;
  const endNote =
    latest.end < `${yearOf(latest)}-12-31` &&
    `up to ${format(parseCalendarDate(latest.end), 'd MMM')}`;
  const partNote = (
    latest === oldest
      ? [
          [startNote, endNote].some(Boolean) &&
            [yearOf(latest), startNote, endNote].filter(Boolean).join(' '),
        ]
      : [startNote && `${yearOf(oldest)} ${startNote}`, endNote && `${yearOf(latest)} ${endNote}`]
  ).filter(Boolean);
  const unit = kind === 'category' ? ['category', 'categories'] : ['source', 'sources'];

  const row = ({
    rowKey,
    name,
    label,
    values,
    total,
    onClick,
  }: {
    rowKey: string;
    name: ReactNode;
    label: string;
    values: (period: Period) => number;
    total?: boolean;
    onClick?: () => void;
  }) => {
    const plain = total || onClick;
    const rowMax = Math.max(
      1,
      ...periods.filter((period) => !thin(period)).map((period) => monthly(period, values(period))),
    );
    const now = monthly(latest, values(latest));
    const before = previous ? monthly(previous, values(previous)) : 0;
    const change = !previous
      ? ''
      : before > 0
        ? signedPct((now - before) / before)
        : now > 0
          ? 'new'
          : '–';
    return (
      <tr key={rowKey} className={cn('[&>td]:p-0.5', total && 'border-t text-muted-foreground')}>
        <th scope='row' className='sticky left-0 z-[1] bg-card pl-5 text-left font-normal'>
          {onClick ? (
            <button
              type='button'
              onClick={onClick}
              className='flex min-h-11 w-full items-center gap-2 pr-2 text-left text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-10'
            >
              <span className='truncate'>{name}</span>
            </button>
          ) : (
            <span className='flex min-h-10 min-w-0 items-center gap-2 pr-2'>{name}</span>
          )}
        </th>
        <td className='pr-3 text-right numeric text-muted-foreground'>{change}</td>
        {periods.map((period) => {
          const value = values(period);
          const average = monthly(period, value);
          const alpha =
            !plain && !thin(period) && value > 0 ? 0.05 + (Math.max(0, average) / rowMax) * 0.4 : 0;
          const from = period.start < historyStart ? historyStart : period.start;
          const tip = `${label}, ${yearOf(period)}: ${formatWholeMoney(average / 100, currency)} a month · ${formatWholeMoney(value / 100, currency)} in the year${period.complete ? '' : ' so far'}`;
          const body = value !== 0 ? formatWholeMoney(average / 100, currency) : '–';
          const className = cn(
            'numeric flex min-h-10 items-center justify-end px-2 text-right',
            value === 0 && 'text-muted-foreground',
            alpha > 0.38 && 'font-semibold',
          );
          return (
            <td key={period.start}>
              {value !== 0 && !plain ? (
                <Link
                  to='/bank-transactions'
                  search={
                    kind === 'category'
                      ? categoryDrill(
                          rowKey as Parameters<typeof categoryDrill>[0],
                          from,
                          period.end,
                          missingBaseAmounts,
                        )
                      : {
                          ...flowDrill('INCOME', from, period.end, missingBaseAmounts),
                          search: label,
                        }
                  }
                  title={tip}
                  aria-label={tip}
                  className={cn(
                    className,
                    'hover:outline-1 hover:outline-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  )}
                  style={{background: alpha ? `hsl(var(--primary) / ${alpha})` : undefined}}
                >
                  {body}
                </Link>
              ) : (
                <span title={value !== 0 ? tip : undefined} className={className}>
                  {body}
                </span>
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <Card role='region' aria-label={title} className='min-w-0 overflow-hidden'>
      <header className='px-5 pt-5 pb-3'>
        <h2 className='text-card-title'>{title}</h2>
        <p className='text-sm text-muted-foreground'>A month, on average, in each year</p>
      </header>
      <div className='overflow-x-auto pb-2'>
        {/* Fixed columns, so the two tables' years line up one above the other. */}
        <table
          className='w-full table-fixed text-sm'
          style={{minWidth: `${14 + periods.length * 5}rem`}}
        >
          <colgroup>
            <col className='w-[9rem] sm:w-[12rem]' />
            <col className='w-[4.5rem]' />
          </colgroup>
          <thead>
            <tr className='text-label text-muted-foreground [&>th]:px-2.5 [&>th]:pb-2 [&>th]:font-medium'>
              <th className='sticky left-0 z-[1] bg-card pl-5 text-left'>
                {kind === 'category' ? 'Category' : 'Source'}
              </th>
              <th
                className='text-right font-normal'
                title={
                  previous
                    ? `${yearOf(latest)} against ${yearOf(previous)}, a month on average`
                    : undefined
                }
              >
                {previous ? `vs ${yearOf(previous)}` : ''}
              </th>
              {periods.map((period) => (
                <th key={period.start} className='text-right numeric'>
                  {yearOf(period)}
                  {!period.complete && '*'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((key) =>
              row({
                rowKey: key,
                label: nameOf(key),
                name: (
                  <>
                    {kind === 'category' && (
                      <i
                        aria-hidden='true'
                        className='size-2.5 shrink-0'
                        style={{background: categoryColor(key)}}
                      />
                    )}
                    <span className='truncate' title={nameOf(key)}>
                      {nameOf(key)}
                    </span>
                  </>
                ),
                values: (period) => cell(period, key),
              }),
            )}
            {rest.length > 0 &&
              !all &&
              row({
                rowKey: 'more',
                label: `${rest.length} more`,
                name: `${rest.length} more ${unit[rest.length === 1 ? 0 : 1]}`,
                values: (period) => rest.reduce((sum, key) => sum + cell(period, key), 0),
                onClick: () => setAll(true),
              })}
            {rest.length > 0 && all && (
              <tr>
                <td colSpan={2} className='sticky left-0 z-[1] bg-card pl-5'>
                  <button
                    type='button'
                    onClick={() => setAll(false)}
                    className='min-h-11 text-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-10'
                  >
                    Show fewer
                  </button>
                </td>
              </tr>
            )}
            {row({
              rowKey: 'total',
              label: 'Total',
              name: 'Total',
              values: (period) => toCents(period.total),
              total: true,
            })}
          </tbody>
        </table>
      </div>
      <p className='px-5 pb-4 text-xs text-muted-foreground'>
        Darker = more than that row&apos;s other years
        {partNote.length > 0 && ` · * part year: ${partNote.join(', ')}`}
      </p>
    </Card>
  );
}
