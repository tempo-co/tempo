import {Link} from '@tanstack/react-router';
import type {BankTransactionBreakdownPeriod} from '@tempo/contracts';
import {ChevronRight} from 'lucide-react';
import {type ReactNode, useMemo, useState} from 'react';

import {TextAction} from '@/components/shared/text-action';
import {Card} from '@/components/ui/card';
import {useHasMissingBaseAmounts} from '@/features/banking/api/use-get-bank-transaction-review-counts';
import {cn} from '@/utils/cn';

import {
  type HeatCell,
  type HeatRow,
  type HeatTableModel,
  type HeatYear,
  buildHeatTable,
} from '../utils/heat-table';
import type {MonthPoint} from '../utils/overview';
import {
  CategoryIconSpacer,
  CategoryName,
  ReadoutCategoryIcon,
  SourceName,
  SourceTile,
} from './category-name';
import {
  DataTip,
  ReadoutRow,
  type ReadoutTip,
  ReadoutTitle,
  TIP_FOCUS,
  TruncatedText,
} from './data-tip';
import {Bone, LoadingLabel, TextBone} from './loading';

/**
 * Rows are categories (or sources), columns years, newest first. A cell is a month on average in that year, so a
 * part year compares fairly with a whole one. Each row is shaded against its own highest year; the first numeric
 * column is the change on the year before. Small rows fold into one "more" row that opens them. Every cell opens
 * its transactions. On a phone each row shows the latest year and its change, and opens into the other years.
 */
export function HeatTable({
  title,
  periods,
  months,
  currency,
  kind,
  columnWidth,
}: {
  title: string;
  periods: BankTransactionBreakdownPeriod[];
  months: MonthPoint[];
  currency: string | null;
  kind: 'category' | 'source';
  /** A CSS width shared by both tables' year columns, from {@link yearColumnWidth}. */
  columnWidth: string;
}) {
  const [all, setAll] = useState(false);
  const missingBaseAmounts = useHasMissingBaseAmounts();
  const model = useMemo(
    () => buildHeatTable({periods, months, currency, kind, missingBaseAmounts}),
    [periods, months, currency, kind, missingBaseAmounts],
  );
  if (!model) return null;
  const {years, latest, previous, top, folded, more, total} = model;
  const rows = all ? [...top, ...folded, total] : [...top, ...(more ? [more] : []), total];
  const fewer = more && all && (
    <TextAction onClick={() => setAll(false)} className='-ml-2'>
      Show fewer
    </TextAction>
  );

  return (
    <Card role='region' aria-label={title} className='min-w-0 overflow-hidden'>
      <HeatTableHeader title={title} />
      <div className='overflow-x-auto pb-2 max-sm:hidden'>
        {/* Fixed columns, so the two tables' years line up one above the other. */}
        <table
          className='w-full table-fixed text-sm'
          style={{minWidth: `calc(16.5rem + ${years.length} * ${columnWidth})`}}
        >
          <colgroup>
            <col className='w-[12rem]' />
            <col className='w-[4.5rem]' />
            {years.map((column) => (
              <col key={column.period.start} style={{width: columnWidth}} />
            ))}
          </colgroup>
          <thead>
            {/* Each header has its column's padding, so headings and figures share one edge. */}
            <tr className='text-label text-muted-foreground'>
              <th className='sticky left-0 z-[1] bg-card pr-2 pb-2 pl-5 text-left align-top font-medium'>
                {nameHeading(kind)}
              </th>
              <th className='pr-3 pb-2 pl-2 text-right align-top font-normal'>
                {previous && (
                  <DataTip tip={`${latest.year} against ${previous.year}, a month on average`}>
                    <span tabIndex={0} className={TIP_FOCUS}>
                      vs {previous.year}
                    </span>
                  </DataTip>
                )}
              </th>
              {years.map((column) => (
                <th
                  key={column.period.start}
                  className='px-2.5 pb-2 text-right align-top font-medium'
                >
                  <YearLabel column={column} />
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
                  ) : row.source ? (
                    <SourceName source={row.source} label={row.name} className='min-h-10 pr-2' />
                  ) : (
                    <span className='flex min-h-10 min-w-0 items-center pr-2'>
                      <TruncatedText className='truncate'>{row.name}</TruncatedText>
                    </span>
                  )}
                </th>
                <td className='pr-3 pl-2 text-right numeric text-muted-foreground'>{row.change}</td>
                {row.cells.map((item) => (
                  <td key={item.period.start} className='p-0.5'>
                    <YearValue row={row} item={item} className='flex min-h-10 justify-end px-2' />
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
        model={model}
        rows={rows}
        onMore={() => setAll(true)}
        fewer={fewer}
        columnWidth={columnWidth}
      />
    </Card>
  );
}

/** The heading over the row names. */
const nameHeading = (kind: 'category' | 'source') => (kind === 'category' ? 'Category' : 'Source');

/** A table's title and what its figures are, loaded or loading. */
function HeatTableHeader({title}: {title: string}) {
  return (
    <header className='px-5 pt-5 pb-3'>
      <h2 className='text-card-title'>{title}</h2>
      <p className='text-sm text-muted-foreground'>A month, on average, in each year</p>
    </header>
  );
}

/** Rows a loading table holds: about the usual top rows, the "more" row and the total. */
const SKELETON_ROWS = 8;

/** A table while its data loads: its title, header and rows at their loaded height. */
export function HeatTableSkeleton({title, kind}: {title: string; kind: 'category' | 'source'}) {
  return (
    <Card role='region' aria-label={title} aria-busy='true' className='min-w-0 overflow-hidden'>
      <LoadingLabel>{`Loading ${title.toLowerCase()}`}</LoadingLabel>
      <HeatTableHeader title={title} />
      <div aria-hidden='true' className='pb-2'>
        <p className='border-b pr-4 pb-2 pl-5 text-label font-medium text-muted-foreground'>
          {nameHeading(kind)}
        </p>
        {Array.from({length: SKELETON_ROWS}, (_, index) => (
          <div
            key={index}
            className='flex min-h-11 items-center gap-2 border-b border-border/60 pr-4 pl-5 text-sm last:border-b-0'
          >
            <Bone className='size-5' />
            <TextBone className='w-[8em]' />
            <TextBone className='ml-auto w-[4em]' />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** A year, with what a part year says under it. */
function YearLabel({column}: {column: HeatYear}) {
  return (
    <span className='numeric'>
      {column.year}
      {column.note && (
        <span className='block text-xs font-normal text-muted-foreground'>{column.note}</span>
      )}
    </span>
  );
}

/** A cell's readout: the row and year, a month on average, the year's total, and the change on the year before. */
function readoutTip(row: HeatRow, {tip}: HeatCell): ReadoutTip {
  return {
    label: tip.label,
    readout: (
      <>
        <ReadoutTitle
          note={tip.note}
          icon={
            row.category ? (
              <ReadoutCategoryIcon category={row.category} />
            ) : row.source ? (
              <SourceTile source={row.source} small />
            ) : undefined
          }
        >
          {row.name}
        </ReadoutTitle>
        <ReadoutRow label='A month' value={tip.month} strong />
        <ReadoutRow label={tip.soFar ? 'So far this year' : 'In the year'} value={tip.year} />
        {tip.versus && <ReadoutRow label={tip.versus.label} value={tip.versus.value} muted />}
        {tip.folded.length > 0 && (
          <div className='mt-1 grid grid-cols-1 gap-1'>
            {tip.folded.map((part) => (
              <ReadoutRow key={part.key} label={part.name} value={part.month} />
            ))}
          </div>
        )}
      </>
    ),
  };
}

/** A year's monthly average, shaded against the row's other years, opening its transactions; its tip names both. */
function YearValue({
  row,
  item,
  lead,
  className,
}: {
  row: HeatRow;
  item: HeatCell;
  lead?: ReactNode;
  className?: string;
}) {
  const tip = readoutTip(row, item);
  const classes = cn(
    'numeric items-center text-right',
    item.value === 0 && 'text-muted-foreground',
    item.alpha > 0.38 && 'font-semibold',
    className,
  );
  const amount = lead ? <span className='numeric whitespace-nowrap'>{item.body}</span> : item.body;
  if (!item.search)
    return (
      <DataTip tip={item.value !== 0 && tip}>
        <span tabIndex={item.value !== 0 ? 0 : undefined} className={cn(classes, TIP_FOCUS)}>
          {lead}
          {amount}
        </span>
      </DataTip>
    );
  return (
    <DataTip tip={tip}>
      <Link
        to='/bank-transactions'
        search={item.search}
        aria-label={tip.label}
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
  model,
  rows,
  onMore,
  fewer,
  columnWidth,
}: {
  model: HeatTableModel;
  /** The rows the table shows, folded or not. */
  rows: HeatRow[];
  onMore: () => void;
  fewer: ReactNode;
  columnWidth: string;
}) {
  const {kind, years, latest, previous} = model;
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
        <span>{nameHeading(kind)}</span>
        <span className='text-right font-normal'>{previous ? `vs ${previous.year}` : ''}</span>
        <span className='text-right'>
          <YearLabel column={latest} />
        </span>
      </p>
      <ul>
        {rows.map((row) => {
          const expanded = open === row.key;
          const latestCell = row.cells[0];
          const name = 'line-clamp-2 leading-tight [overflow-wrap:anywhere]';
          const figures = (
            <>
              <span className='text-right numeric whitespace-nowrap text-muted-foreground'>
                {row.change}
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
                  <CategoryIconSpacer />
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
                ) : row.source ? (
                  <SourceName source={row.source} label={row.name} labelClassName={name} />
                ) : (
                  <span className='flex min-w-0 items-center gap-2'>
                    {/* Every name starts at the same place, icon or not. */}
                    <CategoryIconSpacer />
                    <TruncatedText className={name}>{row.name}</TruncatedText>
                  </span>
                )}
                {figures}
              </button>
              {expanded && (
                <ul
                  aria-label={`${row.name} by year`}
                  className='grid gap-1 bg-muted/20 px-4 py-2'
                  // As many columns as fit a year and its amount, so a large amount never runs into the next.
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, calc(${columnWidth} + 3rem)), 1fr))`,
                  }}
                >
                  {row.cells.map((item, index) => (
                    <li key={item.period.start}>
                      <YearValue
                        row={row}
                        item={item}
                        lead={
                          <span className='text-left font-normal text-muted-foreground'>
                            <YearLabel column={years[index]} />
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
