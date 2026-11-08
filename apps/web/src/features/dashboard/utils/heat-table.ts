import type {
  BankTransactionBreakdownPart,
  BankTransactionBreakdownPeriod,
  BankTransactionCategoryFilterValue,
} from '@tempo/contracts';
import {format} from 'date-fns';

import {
  type BankTransactionDrillSearch,
  categoryDrill,
  parseCalendarDate,
  sourceDrill,
} from './drill-links';
import {categoryLabel, signedPct, wholeCents} from './format';
import {toCents} from './money';
import {type MonthPoint, monthsCovered} from './overview';

type Period = BankTransactionBreakdownPeriod;

/** A year with fewer months of history than this is too thin for its monthly average to be shaded. */
const THIN_MONTHS = 3;
/** Rows under this share of all time fold into one "more" row... */
const FOLD_SHARE = 0.03;
/** ...keeping at least this many rows and at most this many. */
const MIN_ROWS = 3;
const MAX_ROWS = 8;
/** How many of the folded rows a "more" cell's tip names. */
const TIP_FOLDED = 3;

/** A year column: its year, and what a part year says under it. */
export type HeatYear = {
  period: Period;
  year: string;
  /** "from Dec" for a first year cut at the start of history, "so far" for the running year, or both. */
  note: string;
};

/** What a cell's readout tip shows. */
export type HeatTip = {
  /** The sentence screen readers hear. */
  label: string;
  /** The year and its part-year note, beside the row's name. */
  note: string;
  /** A month on average, and the year's total. */
  month: string;
  year: string;
  soFar: boolean;
  /** The change on the year before, for a category or source with a year before. */
  versus?: {label: string; value: string};
  /** A "more" cell's largest folded rows that year, a month on average each. */
  folded: {key: string; name: string; month: string}[];
};

/** A row's figures for one year: the monthly average, its shading, its tip, and where it links. */
export type HeatCell = {
  period: Period;
  /** Cents in the year. */
  value: number;
  body: string;
  tip: HeatTip;
  alpha: number;
  search?: BankTransactionDrillSearch;
};

/** One row of the table: a category or source, the folded rest, or the total. */
export type HeatRow = {
  key: string;
  /** The row's heading, which also names it in tooltips. */
  name: string;
  /** The category a category row is, shown with its icon. */
  category?: string;
  /** The source a source row is, shown with its logo or icon. */
  source?: BankTransactionBreakdownPart;
  /** `more` opens the folded rows; `total` is plain. */
  role?: 'more' | 'total';
  /** The latest year against the one before, as the change column shows it; empty with one year. */
  change: string;
  /** One per year, newest first. */
  cells: HeatCell[];
};

export type HeatTableModel = {
  kind: 'category' | 'source';
  /** Years with history, newest first. */
  years: HeatYear[];
  latest: HeatYear;
  previous?: HeatYear;
  /** The rows shown while small rows are folded, then the rows they fold, largest first. */
  top: HeatRow[];
  folded: HeatRow[];
  /** The row standing in for `folded`; none when nothing folds. */
  more?: HeatRow;
  total: HeatRow;
};

/**
 * Rows are categories (or sources), years newest first. A cell is a month on average in that year, so a part year
 * compares fairly with a whole one, shaded against the row's highest year. Rows under a small share of all time
 * fold into one "more" row. Null when no year has history or no part has an amount.
 */
export function buildHeatTable({
  periods: oldestFirst,
  months,
  currency,
  kind,
  missingBaseAmounts,
}: {
  periods: Period[];
  months: MonthPoint[];
  currency: string | null;
  kind: 'category' | 'source';
  missingBaseAmounts: boolean;
}): HeatTableModel | null {
  const cover = new Map(oldestFirst.map((period) => [period.start, monthsCovered(period, months)]));
  // Newest year first, so the recent years are in view on a phone and older ones scroll in.
  const periods = [...oldestFirst].reverse().filter((period) => (cover.get(period.start) ?? 0) > 0);
  const keys = [...new Set(periods.flatMap((period) => period.parts.map((part) => part.key)))];
  if (keys.length === 0 || months.length === 0) return null;

  // Each part's cents by year, read once; a year without the part has none.
  const cents = new Map(
    periods.map((period) => {
      const parts = new Map<string, number>();
      for (const part of period.parts)
        if (!parts.has(part.key)) parts.set(part.key, toCents(part.amount));
      return [period, parts] as const;
    }),
  );
  const partCents = (period: Period, key: string) => cents.get(period)!.get(key) ?? 0;
  const thin = (period: Period) => (cover.get(period.start) ?? 0) < THIN_MONTHS;
  const monthly = (period: Period, value: number) => value / (cover.get(period.start) ?? 1);
  const money = (value: number) => wholeCents(value, currency);

  const allTime = new Map(
    keys.map((key) => [key, periods.reduce((sum, period) => sum + partCents(period, key), 0)]),
  );
  keys.sort((a, b) => allTime.get(b)! - allTime.get(a)!);
  const grand = keys.reduce((sum, key) => sum + allTime.get(key)!, 0);
  const sources = new Map(
    periods.flatMap((period) => period.parts.map((part) => [part.key, part] as const)),
  );
  const nameOf = (key: string) =>
    kind === 'category' ? categoryLabel(key) : (sources.get(key)?.label ?? key);
  const topKeys = keys.filter(
    (key, index) =>
      index < MIN_ROWS || (index < MAX_ROWS && allTime.get(key)! >= grand * FOLD_SHARE),
  );
  const restKeys = keys.filter((key) => !topKeys.includes(key));

  const [latest, previous] = periods;
  const yearOf = (period: Period) => period.start.slice(0, 4);
  const historyStart = `${months[0].month}-01`;
  const oldest = periods[periods.length - 1];
  // A part year says so under its year, as the year table does: the first year from its first month, the latest so far.
  const startNote =
    historyStart > oldest.start && `from ${format(parseCalendarDate(historyStart), 'MMM')}`;
  const last = months[months.length - 1];
  const running = !last.complete && last.month.startsWith(yearOf(latest));
  const years: HeatYear[] = periods.map((period) => ({
    period,
    year: yearOf(period),
    note: [period === oldest && startNote, period === latest && running && 'so far']
      .filter(Boolean)
      .join(' · '),
  }));

  type Heading = Omit<HeatRow, 'change' | 'cells'>;
  /** A row's cents in a year. */
  type Values = (period: Period) => number;

  /** A row's monthly average in `period` against the year before's, as the change column shows it. */
  const changeIn = (values: Values, period: Period, before: Period) => {
    const now = monthly(period, values(period));
    const then = monthly(before, values(before));
    return then > 0 ? signedPct((now - then) / then) : now > 0 ? 'new' : '–';
  };

  /** A cell's readout: the row and year, a month on average, the year's total, and the change on the year before. */
  const tipOf = (
    row: Heading,
    values: Values,
    column: HeatYear,
    index: number,
    value: number,
  ): HeatTip => {
    const {period} = column;
    const average = monthly(period, value);
    const before = periods[index + 1];
    // Only the running year is so far; a first year cut at the start of history is whole from there.
    const soFar = period === latest && running;
    const folded =
      row.role === 'more'
        ? restKeys
            .map((key) => ({key, cents: partCents(period, key)}))
            .filter((part) => part.cents > 0)
            .sort((a, b) => b.cents - a.cents)
            .slice(0, TIP_FOLDED)
            .map((part) => ({
              key: part.key,
              name: nameOf(part.key),
              month: `${money(monthly(period, part.cents))} a month`,
            }))
        : [];
    return {
      label: `${row.name}, ${column.year}: ${money(average)} a month · ${money(value)} in the year${soFar ? ' so far' : ''}`,
      note: [column.year, column.note].filter(Boolean).join(' '),
      month: money(average),
      year: money(value),
      soFar,
      versus:
        !row.role && before
          ? {label: `vs ${yearOf(before)}`, value: changeIn(values, period, before)}
          : undefined,
      folded,
    };
  };

  const build = (row: Heading, values: Values): HeatRow => {
    const byYear = periods.map(values);
    const rowMax = Math.max(
      1,
      ...periods.flatMap((period, index) => (thin(period) ? [] : [monthly(period, byYear[index])])),
    );
    return {
      ...row,
      change: previous ? changeIn(values, latest, previous) : '',
      cells: years.map((column, index) => {
        const {period} = column;
        const value = byYear[index];
        const average = monthly(period, value);
        const from = period.start < historyStart ? historyStart : period.start;
        return {
          period,
          value,
          body: value !== 0 ? money(average) : '–',
          tip: tipOf(row, values, column, index, value),
          alpha:
            !row.role && !thin(period) && value > 0
              ? 0.05 + (Math.max(0, average) / rowMax) * 0.4
              : 0,
          search:
            value === 0 || row.role
              ? undefined
              : kind === 'category'
                ? categoryDrill(
                    row.key as BankTransactionCategoryFilterValue,
                    from,
                    period.end,
                    missingBaseAmounts,
                  )
                : sourceDrill(row.key, from, period.end, missingBaseAmounts),
        };
      }),
    };
  };

  const partRow = (key: string) =>
    build(
      {
        key,
        name: nameOf(key),
        category: kind === 'category' ? key : undefined,
        source: kind === 'source' ? sources.get(key) : undefined,
      },
      (period) => partCents(period, key),
    );
  const unit = kind === 'category' ? ['category', 'categories'] : ['source', 'sources'];

  return {
    kind,
    years,
    latest: years[0],
    previous: years[1],
    top: topKeys.map(partRow),
    folded: restKeys.map(partRow),
    more:
      restKeys.length > 0
        ? build(
            {
              key: 'more',
              name: `${restKeys.length} more ${unit[restKeys.length === 1 ? 0 : 1]}`,
              role: 'more',
            },
            (period) => restKeys.reduce((sum, key) => sum + partCents(period, key), 0),
          )
        : undefined,
    total: build({key: 'total', name: 'Total', role: 'total'}, (period) => toCents(period.total)),
  };
}
