import {addDays, format, getDaysInMonth, startOfWeek} from 'date-fns';
import {Check, Clock} from 'lucide-react';
import {type ReactNode, useState} from 'react';

import {Card} from '@/components/ui/card';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {cn} from '@/utils/cn';

import {type CalendarItem, MONTH_KIND_LABELS, type MonthGroupId} from '../utils/recurring-month';

/** Chips a day shows before "+N more"; the rest are listed under the calendar. */
const DAY_CHIPS = 3;
/** On phones a day is too narrow to tap a payment in it, so it shows names only and opens its list. */
const PHONE_DAY_LABELS = 2;

/**
 * This month as a calendar, weeks from Monday: each payment on the day it was paid or is expected. A late payment
 * from an earlier month is listed above the grid, since its day is not on it. A day with more payments than fit, and
 * any day on a phone, lists its payments under the grid as rows.
 */
export function RecurringCalendar({
  asOf,
  items,
  formatItemAmount,
  rowFor,
  selectedKey,
  onOpen,
}: {
  asOf: string;
  items: CalendarItem[];
  formatItemAmount: (item: CalendarItem) => string;
  /** The shared row for a payment in a day's list. */
  rowFor: (item: CalendarItem) => ReactNode;
  selectedKey: string | null;
  onOpen: (key: string) => void;
}) {
  const phone = useIsMobile();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const toggleDay = (date: string) => setOpenDay((current) => (current === date ? null : date));
  const month = asOf.slice(0, 7);
  const first = parseCalendarDate(`${month}-01`);
  const days = Array.from({length: getDaysInMonth(first)}, (_, index) => addDays(first, index));
  const lead = (first.getDay() + 6) % 7;
  const weekdays = Array.from({length: 7}, (_, index) =>
    addDays(startOfWeek(first, {weekStartsOn: 1}), index),
  );
  const earlier = items.filter((item) => item.date < `${month}-01`);
  const dayItems = openDay ? items.filter((item) => item.date === openDay) : [];
  const rows = (list: CalendarItem[], label: string) => (
    <ul aria-label={label} className='divide-y divide-border/60 rounded-lg border'>
      {list.map((item) => (
        <li key={item.id} data-testid={`recurring-calendar-item-${item.series.key}`}>
          {rowFor(item)}
        </li>
      ))}
    </ul>
  );

  return (
    <Card className='grid grid-cols-1 gap-3 p-4 max-sm:px-2'>
      <h2 className='text-card-title max-sm:px-2'>{format(first, 'MMMM')}</h2>
      {earlier.length > 0 &&
        (phone ? (
          <div className='grid grid-cols-1 gap-2'>
            <p className='px-2 text-body-small text-muted-foreground'>
              Still late from {format(parseCalendarDate(earlier[0].date), 'MMMM')}
            </p>
            {rows(earlier, `Still late from ${format(parseCalendarDate(earlier[0].date), 'MMMM')}`)}
          </div>
        ) : (
          <div className='flex flex-wrap items-center gap-2 text-body-small text-muted-foreground'>
            <span>Still late from {format(parseCalendarDate(earlier[0].date), 'MMMM')}</span>
            {earlier.map((item) => (
              <span key={item.id} className='w-32 max-w-full'>
                <CalendarChip
                  item={item}
                  amount={formatItemAmount(item)}
                  selected={item.series.key === selectedKey}
                  onOpen={onOpen}
                />
              </span>
            ))}
          </div>
        ))}
      <div
        aria-hidden
        className='grid grid-cols-7 gap-1 text-center text-caption text-muted-foreground'
      >
        {weekdays.map((day) => (
          <span key={day.getDay()} className='py-1'>
            {format(day, phone ? 'EEEEE' : 'EEE')}
          </span>
        ))}
      </div>
      <ol aria-label={`${format(first, 'MMMM')} calendar`} className='grid grid-cols-7 gap-1'>
        {Array.from({length: lead}, (_, index) => (
          <li key={`lead-${index}`} aria-hidden />
        ))}
        {days.map((day) => {
          const date = format(day, 'yyyy-MM-dd');
          const onDay = items.filter((item) => item.date === date);
          const number = (
            <span
              className={cn(
                'px-1 text-caption text-muted-foreground',
                date >= asOf && 'text-foreground',
                date === asOf && 'font-semibold',
              )}
            >
              {day.getDate()}
            </span>
          );
          return (
            <li
              key={date}
              data-testid={`recurring-day-${date}`}
              aria-current={date === asOf ? 'date' : undefined}
              className={cn(
                'flex min-h-20 min-w-0 flex-col gap-1 rounded-md bg-sunk p-1 max-md:min-h-14 max-md:p-0',
                date === asOf && 'outline-2 -outline-offset-2 outline-primary',
                date === openDay && 'bg-accent',
              )}
            >
              {phone && onDay.length > 0 ? (
                <button
                  type='button'
                  onClick={() => toggleDay(date)}
                  aria-expanded={date === openDay}
                  aria-label={`${format(day, 'd MMMM')}, ${onDay.length} ${onDay.length === 1 ? 'payment' : 'payments'}`}
                  className='flex h-full min-h-14 w-full min-w-0 flex-col gap-0.5 rounded-md p-0.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                >
                  {number}
                  {onDay.slice(0, PHONE_DAY_LABELS).map((item) => (
                    <span
                      key={item.id}
                      className={cn(
                        'flex min-w-0 items-center gap-0.5 rounded-sm bg-card px-0.5 text-caption leading-tight',
                        item.kind === 'paid' && 'text-muted-foreground',
                        item.kind === 'late' && 'bg-warning-muted text-warning',
                      )}
                    >
                      <KindIcon kind={item.kind} />
                      <span className='truncate'>{item.series.name}</span>
                    </span>
                  ))}
                  {onDay.length > PHONE_DAY_LABELS && (
                    <span className='px-0.5 text-caption text-muted-foreground'>
                      +{onDay.length - PHONE_DAY_LABELS}
                    </span>
                  )}
                </button>
              ) : (
                <>
                  {number}
                  {onDay.slice(0, DAY_CHIPS).map((item) => (
                    <CalendarChip
                      key={item.id}
                      item={item}
                      amount={formatItemAmount(item)}
                      selected={item.series.key === selectedKey}
                      onOpen={onOpen}
                    />
                  ))}
                  {onDay.length > DAY_CHIPS && (
                    <button
                      type='button'
                      onClick={() => toggleDay(date)}
                      aria-expanded={date === openDay}
                      className='rounded-sm px-1 text-left text-caption text-primary hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11'
                    >
                      +{onDay.length - DAY_CHIPS} more
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {openDay && dayItems.length > 0 && (
        <section
          aria-label={`Payments on ${format(parseCalendarDate(openDay), 'd MMMM')}`}
          className='grid grid-cols-1 gap-2'
        >
          <h3 className='text-card-title max-sm:px-2'>
            {format(parseCalendarDate(openDay), 'EEEE d MMMM')}
          </h3>
          {rows(dayItems, `Payments on ${format(parseCalendarDate(openDay), 'd MMMM')}`)}
        </section>
      )}
      <p className='flex flex-wrap gap-x-4 gap-y-1 text-body-small text-muted-foreground max-sm:px-2'>
        <span className='inline-flex items-center gap-1'>
          <Check aria-hidden className='size-3.5' />
          Paid
        </span>
        <span className='inline-flex items-center gap-1'>
          <Clock aria-hidden className='size-3.5 text-warning' />
          Late
        </span>
      </p>
    </Card>
  );
}

function KindIcon({kind}: {kind: MonthGroupId}) {
  if (kind === 'paid') return <Check aria-hidden className='size-3 shrink-0' />;
  if (kind === 'late') return <Clock aria-hidden className='size-3 shrink-0' />;
  return null;
}

function CalendarChip({
  item,
  amount,
  selected,
  onOpen,
}: {
  item: CalendarItem;
  amount: string;
  selected: boolean;
  onOpen: (key: string) => void;
}) {
  const {series, kind} = item;
  const isIncome = series.direction === 'INCOME';
  return (
    <button
      type='button'
      onClick={() => onOpen(series.key)}
      aria-current={selected || undefined}
      aria-label={`${series.name}, ${isIncome ? '+' : ''}${amount}, ${MONTH_KIND_LABELS[kind]}`}
      className={cn(
        'grid w-full min-w-0 rounded-sm bg-card px-1 py-0.5 text-left text-caption leading-tight hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=true]:outline-2 aria-[current=true]:-outline-offset-2 aria-[current=true]:outline-primary pointer-coarse:min-h-11',
        kind === 'paid' && 'text-muted-foreground',
        kind === 'late' && 'bg-warning-muted text-warning',
      )}
    >
      <span className='flex min-w-0 items-center gap-0.5 font-medium'>
        <KindIcon kind={kind} />
        <span className='truncate'>{series.name}</span>
      </span>
      <span className={cn('truncate numeric', isIncome && kind !== 'late' && 'text-success')}>
        {isIncome && '+'}
        {amount}
      </span>
    </button>
  );
}
