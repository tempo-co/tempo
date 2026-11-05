import {Link} from '@tanstack/react-router';
import {format} from 'date-fns';
import {type ReactNode, useState} from 'react';

import {Card} from '@/components/ui/card';
import {cn} from '@/utils/cn';

import {parseCalendarDate, periodDrill} from '../utils/drill-links';
import {pct, signed, signedPct, wholeCents} from '../utils/format';
import {formatMonth} from '../utils/month';
import {type MonthPoint, type Overview, SPANS, type Span, spanMonths} from '../utils/overview';
import {EventLine} from './event-line';
import {BalanceChart, KeptStrip, Y_WIDTH} from './history-charts';
import {RepeatsBlock} from './repeats-block';

/**
 * Where the owner stands over a span: the total balance and its change, the balance line with one-off dots, what
 * was kept each month on the same axis, the span's figures and what repeats. Any month opens over Home.
 */
export function WhereYouStand({
  overview,
  onOpenMonth,
}: {
  overview: Overview;
  onOpenMonth: (month: string) => void;
}) {
  const [span, setSpan] = useState<Span>('1y');
  const {shown, base, change} = spanMonths(overview, span);
  const currency = overview.currency;
  const total = wholeCents(overview.total, currency);
  const since = base
    ? format(parseCalendarDate(base.end), 'd MMM yyyy')
    : formatMonth(overview.months[0].month, 'MMM yyyy');

  return (
    <Card
      role='region'
      aria-label='Where you stand'
      className='grid gap-6 p-5 sm:p-6 @[60rem]:grid-cols-[minmax(0,1fr)_19rem]'
    >
      {/* Beside the details, the balance chart grows to the details' height so neither column ends early. */}
      <div className='flex min-w-0 flex-col gap-5'>
        <div className='flex flex-wrap items-end justify-between gap-x-6 gap-y-3'>
          <div className='min-w-0'>
            <h2 className='text-label text-muted-foreground'>Total balance</h2>
            {/* Whole and on one line: a long total steps down a size on a phone rather than wrap a digit. */}
            <p
              className={cn(
                'leading-none font-semibold tracking-tight whitespace-nowrap [font-variant-numeric:proportional-nums] sm:text-6xl',
                total.length > 9 ? 'text-4xl' : 'text-5xl',
              )}
            >
              {total}
            </p>
            {change !== null && (
              <p className='mt-2 text-sm'>
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
                <span className='ml-1.5 text-muted-foreground'>since {since}</span>
              </p>
            )}
          </div>
          <SpanSwitch value={span} onChange={setSpan} />
        </div>
        <BalanceChart months={shown} currency={currency} onPick={onOpenMonth} />
        <p
          className='-mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'
          style={{paddingLeft: Y_WIDTH}}
        >
          <span className='inline-flex items-center gap-1.5'>
            <i aria-hidden='true' className='size-2.5 rounded-full bg-success' />
            one-off in
          </span>
          <span className='inline-flex items-center gap-1.5'>
            <i aria-hidden='true' className='size-2.5 rounded-full bg-foreground' />
            one-off out
          </span>
          <span>Tap a month to open it</span>
        </p>
        <KeptStrip months={shown} currency={currency} onPick={onOpenMonth} />
      </div>
      <div className='grid min-w-0 content-start gap-6 border-t pt-5 @[60rem]:border-t-0 @[60rem]:border-l @[60rem]:pt-0 @[60rem]:pl-6'>
        <SpanDetails
          key={span}
          overview={overview}
          months={base ? shown.slice(1) : shown}
          onOpenMonth={onOpenMonth}
        />
        <RepeatsBlock today={overview.today} className='border-t pt-5' />
      </div>
    </Card>
  );
}

function SpanSwitch({value, onChange}: {value: Span; onChange: (value: Span) => void}) {
  return (
    <div role='group' aria-label='Span' className='flex border'>
      {SPANS.map((option) => (
        <button
          key={option.value}
          type='button'
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-11 min-w-11 px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:min-h-9',
            value === option.value
              ? 'bg-foreground font-medium text-background'
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One-off rows shown before "Show all", so a span with many keeps the details beside the chart. */
const EVENT_ROWS = 3;

/** The span's money in, out and kept, the balance it moved between, and its one-off payments. */
function SpanDetails({
  overview,
  months,
  onOpenMonth,
}: {
  overview: Overview;
  months: MonthPoint[];
  onOpenMonth: (month: string) => void;
}) {
  const currency = overview.currency;
  const income = months.reduce((sum, point) => sum + point.income, 0);
  const spending = months.reduce((sum, point) => sum + point.spending, 0);
  const kept = income - spending;
  const [allEvents, setAllEvents] = useState(false);
  const events = months.flatMap((point) => point.events);
  const shownEvents = allEvents ? events : events.slice(0, EVENT_ROWS);
  const startIndex = overview.months.indexOf(months[0]) - 1;
  const startBalance = startIndex >= 0 ? overview.months[startIndex].balance : 0;
  const from = `${months[0].month}-01`;
  return (
    <section aria-label='This span' className='grid min-w-0 content-start gap-4'>
      <h2 className='text-card-title'>{format(parseCalendarDate(from), 'MMM yyyy')} – now</h2>
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
              <span className='whitespace-nowrap'>{wholeCents(startBalance, currency)}</span> →{' '}
              <span className='whitespace-nowrap'>{wholeCents(overview.total, currency)}</span>
            </>
          }
          wide
        />
      </dl>
      <div className='grid gap-1'>
        <h3 className='text-label text-muted-foreground'>
          {events.length === 0 ? 'No one-off payments' : `One-off payments · ${events.length}`}
        </h3>
        {events.length > 0 && (
          <ul className='-mx-2 grid'>
            {shownEvents.map((event) => (
              <li key={event.id}>
                <button
                  type='button'
                  onClick={() => onOpenMonth(event.date.slice(0, 7))}
                  className='block min-h-11 w-full px-2 py-2 text-left hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                >
                  <EventLine event={event} currency={currency} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {events.length > EVENT_ROWS && (
          <button
            type='button'
            aria-expanded={allEvents}
            onClick={() => setAllEvents(!allEvents)}
            className='inline-flex min-h-11 w-fit items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring'
          >
            {allEvents ? 'Show fewer' : `Show all ${events.length}`}
          </button>
        )}
      </div>
      <Link
        to='/bank-transactions'
        search={periodDrill(from, overview.today)}
        className='inline-flex min-h-11 w-fit items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring'
      >
        Transactions in this span
      </Link>
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
