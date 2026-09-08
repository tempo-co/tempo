import {useNavigate} from '@tanstack/react-router';
import {format} from 'date-fns';
import {CalendarIcon, ChevronDown} from 'lucide-react';
import * as React from 'react';
import {DateRange} from 'react-day-picker';

import {Button} from '@/components/ui/button';
import {Calendar} from '@/components/ui/calendar';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/utils/cn';

import {BankTransactionFilterParams} from '../types/bank-transaction';

type BankTransactionDateFilterProps = {
  filters: BankTransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<BankTransactionFilterParams>>;
  className?: string;
};

export function BankTransactionDateFilter({
  filters,
  setFilters,
  className,
}: BankTransactionDateFilterProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});

  const handleSelect = async (range: DateRange | undefined) => {
    const bookingDate = range?.from ? {from: range.from, to: range.to} : undefined;
    await navigate({
      search: (prev) => ({...prev, bookingDate, pageIndex: 0}),
    });
    setFilters((prev) => ({...prev, bookingDate}));
  };

  const handleReset = async () => {
    await navigate({search: (prev) => ({...prev, bookingDate: undefined, pageIndex: 0})});
    setFilters((prev) => ({...prev, bookingDate: undefined}));
  };

  const bookingDateFrom = filters.bookingDate?.from;
  const bookingDateTo = filters.bookingDate?.to;
  const fullBookingDateLabel = bookingDateFrom
    ? `${format(bookingDateFrom, 'MMM dd, y')}${
        bookingDateTo ? ` - ${format(bookingDateTo, 'MMM dd, y')}` : ''
      }`
    : undefined;
  const compactBookingDateLabel = bookingDateFrom
    ? `${format(bookingDateFrom, 'MMM d')}${
        bookingDateTo
          ? `–${format(
              bookingDateTo,
              bookingDateFrom.getFullYear() === bookingDateTo.getFullYear() &&
                bookingDateFrom.getMonth() === bookingDateTo.getMonth()
                ? 'd'
                : 'MMM d',
            )}`
          : ''
      }`
    : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={cn('h-10 sm:h-8', filters.bookingDate ? 'border' : 'border-dashed', className)}
          aria-label={fullBookingDateLabel ? `Booking date: ${fullBookingDateLabel}` : undefined}
        >
          <CalendarIcon />
          Booking date
          {fullBookingDateLabel && (
            <>
              <Separator orientation='vertical' className='mx-2 h-4' />
              <span className='min-w-0 truncate text-secondary-foreground max-md:flex-1'>
                <span className='max-md:hidden'>{fullBookingDateLabel}</span>
                <span className='hidden max-md:inline'>{compactBookingDateLabel}</span>
              </span>
            </>
          )}
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0' align='start'>
        <Calendar
          initialFocus
          mode='range'
          defaultMonth={filters.bookingDate?.from}
          selected={filters.bookingDate as DateRange | undefined}
          onSelect={handleSelect}
          disabled={{after: new Date()}}
        />
        {filters.bookingDate !== undefined && (
          <>
            <Separator className='w-full' />
            <div className='p-1'>
              <Button
                className='h-10 w-full rounded-sm sm:h-8'
                variant='ghost'
                onClick={handleReset}
              >
                Reset
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
