import {Link} from '@tanstack/react-router';
import type {BankTransactionBreakdownPeriod} from '@tempo/contracts';
import {format} from 'date-fns';
import {ChevronRight} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {Card} from '@/components/ui/card';
import {useHasMissingBaseAmounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {cn} from '@/utils/cn';

import {categoryDrill, flowDrill, parseCalendarDate} from '../utils/drill-links';
import {categoryLabel, signedPct} from '../utils/format';
import {formatWholeMoney, toCents} from '../utils/money';
import {type MonthPoint, monthsCovered, partCents} from '../utils/overview';
import {CategoryIconSpacer, CategoryName} from './category-name';
import {DataTip, TIP_FOCUS, TruncatedText} from './data-tip';
import {TextAction} from './text-action';

type Period = BankTransactionBreakdownPeriod;

/** A year with fewer months of history than this is too thin for its monthly average to be shaded. */
const THIN_MONTHS = 3;
/** Rows under this share of all time fold into one "more" row... */
const FOLD_SHARE = 0.03;
/** ...keeping at least this many rows and at most this many. */
const MIN_ROWS = 3;
const MAX_ROWS = 8;

/** One row of the table: a category or source, the folded rest, or the total. */
type Row = {
  key: string;
  /** The row's heading; `label` names it in tooltips and searches. */
  name: string;
  label: string;
  /** The category a category row is, shown with its icon. */
  category?: string;
  values: (period: Period) => number;
  /** `more` opens the folded rows; `total` is plain. */
  role?: 'more' | 'total';
};

/** A row's figures for one year: the monthly average, its shading, and where it links. */
type Cell = {
  period: Period;
  value: number;
  body: string;
  tip: string;
  alpha: number;
  search?: ReturnType<typeof categoryDrill>;
};

/**
 * Rows are categories (or sources), columns years, newest first. A cell is a month on average in that year, so a
 * part year compares fairly with a whole one. Each row is shaded against its own highest year; the first numeric
 * column is the change on the year before. Small rows fold into one "more" row that opens them. Every cell opens
 * its transactions. On a phone each row shows the latest year and its change, and opens into the other years.
 */
export function HeatTable({
  title,
  periods: oldestFirst,
  months,
  currency,
  kind,
  columnWidth,
}: {
  title: string;
  periods: Period[];
  months: MonthPoint[];
  currency: string | null;
  kind: 'category' | 'source';
  /** A CSS width shared by both tables' year columns, from {@link yearColumnWidth}. */
  columnWidth: string;
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
  const [latest, previous] = periods;
  const yearOf = (period: Period) => period.start.slice(0, 4);
  const historyStart = `${months[0].month}-01`;
  const oldest = periods[periods.length - 1];
  // A part year says so under its year, as the year table does: the first year from its first month, the latest so far.
  const startNote =
    historyStart > oldest.start && `from ${format(parseCalendarDate(historyStart), 'MMM')}`;
  const last = months[months.length - 1];
  const running = !last.complete && last.month.startsWith(yearOf(latest));
  const yearLabel = (period: Period) => {
    const note = [period === oldest && startNote, period === latest && running && 'so far']
      .filter(Boolean)
      .join(' · ');
    return (
      <span className='numeric'>
        {yearOf(period)}
        {note && <span className='block text-xs font-normal text-muted-foreground'>{note}</span>}
      </span>
    );
  };
  const unit = kind === 'category' ? ['category', 'categories'] : ['source', 'sources'];

  const rows: Row[] = [
    ...(all ? keys : top).map((key) => ({
      key,
      label: nameOf(key),
      name: nameOf(key),
      category: kind === 'category' ? key : undefined,
      values: (period: Period) => cell(period, key),
    })),
    ...(rest.length > 0 && !all
      ? [
          {
            key: 'more',
            label: `${rest.length} more`,
            name: `${rest.length} more ${unit[rest.length === 1 ? 0 : 1]}`,
            values: (period: Period) => rest.reduce((sum, key) => sum + cell(period, key), 0),
            role: 'more' as const,
          },
        ]
      : []),
    {
      key: 'total',
      label: 'Total',
      name: 'Total',
      values: (period: Period) => toCents(period.total),
      role: 'total' as const,
    },
  ];

  const change = (row: Row) => {
    if (!previous) return '';
    const now = monthly(latest, row.values(latest));
    const before = monthly(previous, row.values(previous));
    return before > 0 ? signedPct((now - before) / before) : now > 0 ? 'new' : '–';
  };
  const cells = (row: Row): Cell[] => {
    const rowMax = Math.max(
      1,
      ...periods
        .filter((period) => !thin(period))
        .map((period) => monthly(period, row.values(period))),
    );
    return periods.map((period) => {
      const value = row.values(period);
      const average = monthly(period, value);
      const from = period.start < historyStart ? historyStart : period.start;
      return {
        period,
        value,
        body: value !== 0 ? formatWholeMoney(average / 100, currency) : '–',
        tip: `${row.label}, ${yearOf(period)}: ${formatWholeMoney(average / 100, currency)} a month · ${formatWholeMoney(value / 100, currency)} in the year${period.complete ? '' : ' so far'}`,
        alpha:
          !row.role && !thin(period) && value > 0
            ? 0.05 + (Math.max(0, average) / rowMax) * 0.4
            : 0,
        search:
          value === 0 || row.role
            ? undefined
            : kind === 'category'
              ? categoryDrill(
                  row.key as Parameters<typeof categoryDrill>[0],
                  from,
                  period.end,
                  missingBaseAmounts,
                )
              : {...flowDrill('INCOME', from, period.end, missingBaseAmounts), search: row.label},
      };
    });
  };
  const fewer = rest.length > 0 && all && (
    <TextAction onClick={() => setAll(false)} className='-ml-2'>
      Show fewer
    </TextAction>
  );

  return (
    <Card role='region' aria-label={title} className='min-w-0 overflow-hidden'>
      <header className='px-5 pt-5 pb-3'>
        <h2 className='text-card-title'>{title}</h2>
        <p className='text-sm text-muted-foreground'>A month, on average, in each year</p>
      </header>
      <div className='overflow-x-auto pb-2 max-sm:hidden'>
        {/* Fixed columns, so the two tables' years line up one above the other. */}
        <table
          className='w-full table-fixed text-sm'
          style={{minWidth: `calc(16.5rem + ${periods.length} * ${columnWidth})`}}
        >
          <colgroup>
            <col className='w-[12rem]' />
            <col className='w-[4.5rem]' />
            {periods.map((period) => (
              <col key={period.start} style={{width: columnWidth}} />
            ))}
          </colgroup>
          <thead>
            {/* Each header has its column's padding, so headings and figures share one edge. */}
            <tr className='text-label text-muted-foreground'>
              <th className='sticky left-0 z-[1] bg-card pr-2 pb-2 pl-5 text-left align-top font-medium'>
                {kind === 'category' ? 'Category' : 'Source'}
              </th>
              <th className='pr-3 pb-2 pl-2 text-right align-top font-normal'>
                {previous && (
                  <DataTip
                    tip={`${yearOf(latest)} against ${yearOf(previous)}, a month on average`}
                  >
                    <span tabIndex={0} className={TIP_FOCUS}>
                      vs {yearOf(previous)}
                    </span>
                  </DataTip>
                )}
              </th>
              {periods.map((period) => (
                <th key={period.start} className='px-2.5 pb-2 text-right align-top font-medium'>
                  {yearLabel(period)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={cn(row.role === 'total' && 'border-t text-muted-foreground')}
              >
                <th scope='row' className='sticky left-0 z-[1] bg-card pl-5 text-left font-normal'>
                  {row.role === 'more' ? (
                    <span className='flex min-h-10 items-center'>
                      <TextAction onClick={() => setAll(true)} className='-ml-2'>
                        {row.name}
                      </TextAction>
                    </span>
                  ) : row.category ? (
                    <CategoryName category={row.category} className='min-h-10 pr-2' />
                  ) : (
                    <span className='flex min-h-10 min-w-0 items-center pr-2'>
                      <TruncatedText className='truncate'>{row.name}</TruncatedText>
                    </span>
                  )}
                </th>
                <td className='pr-3 pl-2 text-right numeric text-muted-foreground'>
                  {change(row)}
                </td>
                {cells(row).map((item) => (
                  <td key={item.period.start} className='p-0.5'>
                    <YearValue item={item} className='flex min-h-10 justify-end px-2' />
                  </td>
                ))}
              </tr>
            ))}
            {fewer && (
              <tr>
                <td colSpan={2} className='sticky left-0 z-[1] bg-card pl-5'>
                  {fewer}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PhoneRows
        kind={kind}
        rows={rows}
        latest={latest}
        previous={previous}
        yearLabel={yearLabel}
        change={change}
        cells={cells}
        onMore={() => setAll(true)}
        fewer={fewer}
        columnWidth={columnWidth}
      />
    </Card>
  );
}

/** A year's monthly average, shaded against the row's other years, opening its transactions; its tip names both. */
function YearValue({item, lead, className}: {item: Cell; lead?: ReactNode; className?: string}) {
  const classes = cn(
    'numeric items-center text-right',
    item.value === 0 && 'text-muted-foreground',
    item.alpha > 0.38 && 'font-semibold',
    className,
  );
  const amount = lead ? <span className='numeric whitespace-nowrap'>{item.body}</span> : item.body;
  if (!item.search)
    return (
      <DataTip tip={item.value !== 0 && item.tip}>
        <span tabIndex={item.value !== 0 ? 0 : undefined} className={cn(classes, TIP_FOCUS)}>
          {lead}
          {amount}
        </span>
      </DataTip>
    );
  return (
    <DataTip tip={item.tip}>
      <Link
        to='/bank-transactions'
        search={item.search}
        aria-label={item.tip}
        className={cn(
          classes,
          'hover:outline-1 hover:outline-foreground focus-visible:outline-2 focus-visible:outline-ring',
        )}
        style={{background: item.alpha ? `hsl(var(--primary) / ${item.alpha})` : undefined}}
      >
        {lead}
        {amount}
      </Link>
    </DataTip>
  );
}

/**
 * The phone layout: each row shows the latest year's monthly average and its change on the year before, and opens
 * in place into every year, newest first. The fold row opens the folded rows, as in the table.
 */
function PhoneRows({
  kind,
  rows,
  latest,
  previous,
  yearLabel,
  change,
  cells,
  onMore,
  fewer,
  columnWidth,
}: {
  kind: 'category' | 'source';
  columnWidth: string;
  rows: Row[];
  latest: Period;
  previous: Period | undefined;
  yearLabel: (period: Period) => ReactNode;
  change: (row: Row) => string;
  cells: (row: Row) => Cell[];
  onMore: () => void;
  fewer: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const line = 'grid items-center gap-x-2';
  // The latest year's column is as wide as the table's year columns, less their padding.
  const columns = {gridTemplateColumns: `minmax(0,1fr) 3.5rem calc(${columnWidth} - 1.25rem)`};
  return (
    <div className='pb-2 sm:hidden'>
      <p
        className={cn(line, 'border-b pr-4 pb-2 pl-8 text-label font-medium text-muted-foreground')}
        style={columns}
        aria-hidden='true'
      >
        <span>{kind === 'category' ? 'Category' : 'Source'}</span>
        <span className='text-right font-normal'>
          {previous ? `vs ${previous.start.slice(0, 4)}` : ''}
        </span>
        <span className='text-right'>{yearLabel(latest)}</span>
      </p>
      <ul>
        {rows.map((row) => {
          const expanded = open === row.key;
          const latestCell = cells(row)[0];
          const name = 'line-clamp-2 leading-tight [overflow-wrap:anywhere]';
          const figures = (
            <>
              <span className='text-right numeric whitespace-nowrap text-muted-foreground'>
                {change(row)}
              </span>
              <span
                className={cn(
                  'text-right numeric whitespace-nowrap',
                  latestCell.value === 0 && 'text-muted-foreground',
                )}
              >
                {latestCell.body}
              </span>
            </>
          );
          if (row.role === 'more')
            return (
              <li
                key={row.key}
                style={columns}
                className={cn(line, 'border-b border-border/60 py-1.5 pr-4 pl-8 text-sm')}
              >
                <span className='flex min-w-0 items-center gap-2'>
                  {kind === 'category' && <CategoryIconSpacer />}
                  <TextAction onClick={onMore} className='-ml-2'>
                    {row.name}
                  </TextAction>
                </span>
                {figures}
              </li>
            );
          return (
            <li
              key={row.key}
              className={cn(
                'border-b border-border/60',
                row.role === 'total' && 'border-b-0 text-muted-foreground',
              )}
            >
              <button
                type='button'
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : row.key)}
                style={columns}
                className={cn(
                  line,
                  'relative min-h-11 w-full py-1.5 pr-4 pl-8 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  expanded && 'bg-accent/40',
                )}
              >
                <ChevronRight
                  aria-hidden='true'
                  className={cn(
                    'absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground transition-transform',
                    expanded && 'rotate-90',
                  )}
                />
                {row.category ? (
                  <CategoryName category={row.category} labelClassName={name} />
                ) : (
                  <span className='flex min-w-0 items-center gap-2'>
                    {/* Every name starts at the same place, icon or not. */}
                    {kind === 'category' && <CategoryIconSpacer />}
                    <TruncatedText className={name}>{row.name}</TruncatedText>
                  </span>
                )}
                {figures}
              </button>
              {expanded && (
                <ul
                  aria-label={`${row.label} by year`}
                  className='grid gap-1 bg-muted/20 px-4 py-2'
                  // As many columns as fit a year and its amount, so a large amount never runs into the next.
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, calc(${columnWidth} + 3rem)), 1fr))`,
                  }}
                >
                  {cells(row).map((item) => (
                    <li key={item.period.start}>
                      <YearValue
                        item={item}
                        lead={
                          <span className='text-left font-normal text-muted-foreground'>
                            {yearLabel(item.period)}
                          </span>
                        }
                        className='flex min-h-11 justify-between gap-2 px-2 text-sm'
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {fewer && <div className='px-4'>{fewer}</div>}
    </div>
  );
}
