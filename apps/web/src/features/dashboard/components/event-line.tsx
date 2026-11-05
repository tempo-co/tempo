import {Link} from '@tanstack/react-router';
import {BANK_TRANSACTION_UNCATEGORIZED, type BankTransactionEvent} from '@tempo/contracts';
import {format} from 'date-fns';
import {ArrowDownRight, ArrowUpRight} from 'lucide-react';

import {cn} from '@/utils/cn';

import {eventDrill, parseCalendarDate} from '../utils/drill-links';
import {categoryLabel, eventShare, signedEvent} from '../utils/format';

/** A one-off payment: name, date and category, its amount and how many usual months it was. */
export function EventLine({
  event,
  currency,
  className,
}: {
  event: BankTransactionEvent;
  currency: string | null;
  className?: string;
}) {
  const income = event.direction === 'INCOME';
  const Icon = income ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-sm',
        className,
      )}
    >
      <Icon
        aria-hidden='true'
        className={cn('size-4', income ? 'text-success' : 'text-muted-foreground')}
      />
      <span className='min-w-0'>
        <span className='line-clamp-2 leading-tight [overflow-wrap:anywhere]'>{event.name}</span>
        <span className='block text-xs text-muted-foreground'>
          {format(parseCalendarDate(event.date), 'd MMM yyyy')} ·{' '}
          {categoryLabel(event.category ?? BANK_TRANSACTION_UNCATEGORIZED)}
        </span>
      </span>
      <span className={cn('text-right numeric', income && 'text-success')}>
        {signedEvent(event, currency)}
        <span className='block text-xs whitespace-nowrap text-muted-foreground'>
          {eventShare(event)}
        </span>
      </span>
    </span>
  );
}

/** One-off payments as small links, in a year or month row. */
export function EventChips({
  events,
  currency,
}: {
  events: BankTransactionEvent[];
  currency: string | null;
}) {
  if (events.length === 0) return null;
  return (
    // No width of its own, so a long name never widens the table cell it sits in; it fills the cell instead.
    <ul className='flex w-0 min-w-full flex-wrap gap-1.5 py-1'>
      {events.map((event) => {
        const income = event.direction === 'INCOME';
        const Icon = income ? ArrowUpRight : ArrowDownRight;
        return (
          // A fixed cap, since a table cell would otherwise widen to the longest name.
          <li key={event.id} className='max-w-[min(100%,15rem)] min-w-0'>
            <Link
              to='/bank-transactions'
              search={eventDrill(event)}
              title={`${event.name} · ${format(parseCalendarDate(event.date), 'd MMM yyyy')} · ${eventShare(event)}`}
              className={cn(
                'inline-flex min-h-11 max-w-full min-w-11 items-center gap-1 border px-2 py-1 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring sm:min-h-8',
                income ? 'border-success/40 text-success' : 'border-border text-foreground',
              )}
            >
              <Icon aria-hidden='true' className='size-3.5 shrink-0' />
              <span className='min-w-0 truncate'>{event.name}</span>
              <span className='shrink-0 numeric text-muted-foreground'>
                {signedEvent(event, currency)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
