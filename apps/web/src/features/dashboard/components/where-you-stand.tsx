import {Link} from '@tanstack/react-router';
import {format} from 'date-fns';
import {type ReactNode, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {cn} from '@/utils/cn';

import {useLastMonth} from '../api/use-overview';
import {parseCalendarDate, periodDrill} from '../utils/drill-links';
import {pct, signed, signedPct, wholeCents} from '../utils/format';
import {formatMonth} from '../utils/month';
import {type BalancePoint, type Overview, SPANS, type Span, spanMonths} from '../utils/overview';
import {BalanceChart, BalanceChartSkeleton} from './balance-chart';
import {LoadingLabel, TextBone} from './loading';
import {RepeatsBlock} from './repeats-block';
import {TextAction} from './text-action';

/**
 * Where the owner stands over a span: the total balance and its change, the balance line, the span's figures and
 * what repeats. Any month opens over Home.
 *
 * Until the history arrives, every part holds its place at its loaded size, so nothing moves when it fills in;
 * what repeats loads on its own.
 */
export function WhereYouStand({
  overview,
  today,
  onOpenMonth,
}: {
  overview: Overview | null;
  today: string;
  onOpenMonth: (month: string) => void;
}) {
  const [span, setSpan] = useState<Span>('1y');
  const view = useSpanView(overview, today, span);

  return (
    <Card
      role='region'
      aria-label='Where you stand'
      aria-busy={!overview || (!view.loaded && !view.isError) || undefined}
      className='grid gap-6 p-5 sm:p-6 @[60rem]:grid-cols-[minmax(0,1fr)_19rem]'
    >
      {/* Beside the details, the balance chart grows to the details' height so neither column ends early. */}
      <div className='flex min-w-0 flex-col gap-5'>
        {!overview && <LoadingLabel>Loading your balance</LoadingLabel>}
        <div className='flex flex-wrap items-end justify-between gap-x-6 gap-y-3'>
          <div className='min-w-0'>
            <h2 className='text-label text-muted-foreground'>Total balance</h2>
            <Total overview={overview} view={view.loaded} />
          </div>
          <SpanSwitch value={span} onChange={setSpan} />
        </div>
        {overview && view.loaded ? (
          <BalanceChart
            points={view.loaded.points}
            unit={span === '1m' ? 'day' : 'month'}
            currency={overview.currency}
            onPick={onOpenMonth}
          />
        ) : (
          <BalanceChartSkeleton>
            {view.isError ? (
              <div className='m-auto grid justify-items-center gap-3 text-sm'>
                <p>Could not load the last month.</p>
                <Button variant='outline' onClick={() => void view.refetch()}>
                  Try again
                </Button>
              </div>
            ) : undefined}
          </BalanceChartSkeleton>
        )}
      </div>
      <div className='grid min-w-0 content-start gap-6 border-t pt-5 @[60rem]:border-t-0 @[60rem]:border-l @[60rem]:pt-0 @[60rem]:pl-6'>
        <SpanDetails key={span} overview={overview} view={view.loaded} />
        <RepeatsBlock today={today} className='border-t pt-5' />
      </div>
    </Card>
  );
}

/** What a span shows: its line, the change since its start, and its money. */
type SpanView = {
  points: BalancePoint[];
  /** Where the change is measured from; null measures from zero, before the history. */
  base: {end: string; balance: number | null} | null;
  /** The day the change is measured from: the base's end, or where the history starts. */
  since: string;
  change: number | null;
  /** The first day the span's money counts. */
  from: string;
  heading: string;
  income: number;
  spending: number;
  startBalance: number | null;
};

/** The span's view; 1M loads its own day ends and totals on first selecting it, until then null. */
function useSpanView(overview: Overview | null, today: string, span: Span) {
  const daily = useLastMonth(today, span === '1m');
  if (!overview) return {loaded: null, isError: false, refetch: daily.refetch};
  if (span !== '1m')
    return {loaded: monthSpanView(overview, span), isError: false, refetch: daily.refetch};
  const month = daily.lastMonth;
  if (!month) return {loaded: null, isError: daily.isError, refetch: daily.refetch};
  const base = month.days.find((point) => point.end === month.base) ?? null;
  const from = base ? month.from : (month.days[0]?.end ?? month.from);
  const loaded: SpanView = {
    points: month.days,
    base,
    since: format(parseCalendarDate(base?.end ?? from), 'd MMM yyyy'),
    change:
      overview.total === null || (base && base.balance === null)
        ? null
        : overview.total - (base?.balance ?? 0),
    from,
    heading: `${format(parseCalendarDate(from), 'd MMM')} – now`,
    income: month.income,
    spending: month.spending,
    startBalance: base ? base.balance : 0,
  };
  return {loaded, isError: false, refetch: daily.refetch};
}

/** A span of month ends, its change measured from the month end a span back. */
function monthSpanView(overview: Overview, span: Span): SpanView {
  const {shown, base, change} = spanMonths(overview, span);
  const months = base ? shown.slice(1) : shown;
  const startIndex = overview.months.indexOf(months[0]) - 1;
  const from = `${months[0].month}-01`;
  return {
    points: shown,
    base,
    since: base
      ? format(parseCalendarDate(base.end), 'd MMM yyyy')
      : formatMonth(overview.months[0].month, 'MMM yyyy'),
    change,
    from,
    heading: `${format(parseCalendarDate(from), 'MMM yyyy')} – now`,
    income: months.reduce((sum, point) => sum + point.income, 0),
    spending: months.reduce((sum, point) => sum + point.spending, 0),
    startBalance: startIndex >= 0 ? overview.months[startIndex].balance : 0,
  };
}

/** The total and its change since the span's start; each line is as tall while loading as with figures. */
function Total({overview, view}: {overview: Overview | null; view: SpanView | null}) {
  // One line box for any total: a long one steps down a size on a phone inside the same height.
  const hero =
    'flex h-12 items-end leading-none font-semibold tracking-tight whitespace-nowrap [font-variant-numeric:proportional-nums] sm:h-15 sm:text-6xl';
  if (!overview)
    return (
      <>
        <p className={cn(hero, 'text-5xl')}>
          <TextBone className='w-[3.6em]' />
        </p>
        <p className='mt-2 text-sm'>
          <TextBone className='w-56' />
        </p>
      </>
    );
  const currency = overview.currency;
  const total = wholeCents(overview.total, currency);
  const change = view?.change;
  const base = view?.base;
  return (
    <>
      {/* Whole and on one line: a long total steps down a size on a phone rather than wrap a digit. */}
      <p className={cn(hero, total.length > 9 ? 'text-4xl' : 'text-5xl')}>{total}</p>
      {/* Without a change, or while a span loads, the line stays, empty, so the chart below keeps its place. */}
      <p className='mt-2 text-sm' aria-hidden={change == null || undefined}>
        {change == null ? (
          '\u00a0'
        ) : (
          <>
            <span
              className={cn(
                'numeric font-medium whitespace-nowrap',
                change >= 0 ? 'text-success' : 'text-warning',
              )}
            >
              {signed(change, currency)}
            </span>
            {base?.balance != null && base.balance > 0 && (
              <span className='ml-1.5 numeric whitespace-nowrap text-muted-foreground'>
                {signedPct(change / base.balance)}
              </span>
            )}
            <span className='ml-1.5 text-muted-foreground'>since {view?.since}</span>
          </>
        )}
      </p>
    </>
  );
}

function SpanSwitch({value, onChange}: {value: Span; onChange: (value: Span) => void}) {
  return (
    <ToggleGroup
      type='single'
      value={value}
      onValueChange={(next) => {
        // Pressing the chosen span again leaves it chosen.
        const option = SPANS.find((item) => item.value === next);
        if (option) onChange(option.value);
      }}
      aria-label='Span'
      className='gap-0 border'
    >
      {SPANS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className='h-auto min-h-11 min-w-11 rounded-none px-3 font-normal text-muted-foreground hover:bg-accent hover:text-muted-foreground focus-visible:-outline-offset-2 data-[state=on]:bg-foreground data-[state=on]:font-medium data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background sm:min-h-9'
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The span's money in, out and kept, and the balance it moved between; placeholders while loading. */
function SpanDetails({overview, view}: {overview: Overview | null; view: SpanView | null}) {
  if (!overview || !view)
    return (
      <section aria-label='This span' className='grid min-w-0 content-start gap-4'>
        {/* No heading until it has a name; the box keeps the heading's line. */}
        <p aria-hidden='true' className='text-card-title'>
          <TextBone className='w-[8em]' />
        </p>
        {/* The same five figures in the same places as loaded, so each one fills in where it stands. */}
        <dl className='grid grid-cols-2 gap-x-4 gap-y-3'>
          <Fact label='In' value={<TextBone className='w-[4.5em]' />} />
          <Fact label='Out' value={<TextBone className='w-[4.5em]' />} />
          <Fact label='Kept' value={<TextBone className='w-[4.5em]' />} />
          <Fact label='Kept of income' value={<TextBone className='w-[2.5em]' />} />
          <Fact label='Balance' value={<TextBone className='w-[10em]' />} wide />
        </dl>
        <TextAction disabled className='-ml-2'>
          Transactions in this span
        </TextAction>
      </section>
    );
  const currency = overview.currency;
  const {income, spending} = view;
  const kept = income - spending;
  return (
    <section aria-label='This span' className='grid min-w-0 content-start gap-4'>
      <h2 className='text-card-title'>{view.heading}</h2>
      <dl className='grid grid-cols-2 gap-x-4 gap-y-3'>
        <Fact label='In' value={wholeCents(income, currency)} tone='text-success' />
        <Fact label='Out' value={wholeCents(spending, currency)} />
        <Fact
          label='Kept'
          value={signed(kept, currency)}
          tone={kept < 0 ? 'text-warning' : undefined}
        />
        <Fact label='Kept of income' value={income > 0 ? pct(kept / income) : '—'} />
        <Fact
          label='Balance'
          value={
            <>
              <span className='whitespace-nowrap'>{wholeCents(view.startBalance, currency)}</span> →{' '}
              <span className='whitespace-nowrap'>{wholeCents(overview.total, currency)}</span>
            </>
          }
          wide
        />
      </dl>
      <TextAction asChild className='-ml-2'>
        <Link to='/bank-transactions' search={periodDrill(view.from, overview.today)}>
          Transactions in this span
        </Link>
      </TextAction>
    </section>
  );
}

function Fact({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  wide?: boolean;
}) {
  // A long amount steps down a size rather than wrap its sign onto a line of its own.
  const long = typeof value === 'string' ? value.length > 10 : false;
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <dt className='text-label text-muted-foreground'>{label}</dt>
      <dd
        className={cn(
          'numeric text-lg font-semibold max-[22rem]:text-base',
          typeof value === 'string' && 'whitespace-nowrap',
          long && 'text-base max-[22rem]:text-sm',
          tone,
        )}
      >
        {value}
      </dd>
    </div>
  );
}
