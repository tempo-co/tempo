import {useNavigate} from '@tanstack/react-router';
import {format} from 'date-fns';
import {CalendarIcon, ChevronDown} from 'lucide-react';
import * as React from 'react';
import {DateRange} from 'react-day-picker';

import {Button, buttonVariants} from '@/components/ui/button';
import {Calendar} from '@/components/ui/calendar';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/utils/cn';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';

type BankTransactionDateFilterProps = {
  filters: BankTransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<BankTransactionFilterParams>>;
  variant?: 'popover' | 'mobile';
  className?: string;
};

export function BankTransactionDateFilter({
  filters,
  setFilters,
  variant = 'popover',
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

  const calendar = (
    <Calendar
      className={variant === 'mobile' ? 'w-full' : undefined}
      classNames={
        variant === 'mobile'
          ? {
              month: 'w-full space-y-4',
              head_row: 'flex w-full',
              head_cell: 'text-muted-foreground rounded-md flex-1 font-normal text-[0.8rem]',
              row: 'flex w-full mt-2',
              cell: 'h-9 flex-1 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20',
              day: cn(
                buttonVariants({variant: 'ghost'}),
                'h-9 w-full p-0 font-normal aria-selected:opacity-100',
              ),
            }
          : undefined
      }
      initialFocus
      mode='range'
      defaultMonth={filters.bookingDate?.from}
      selected={filters.bookingDate as DateRange | undefined}
      onSelect={handleSelect}
      disabled={{after: new Date()}}
    />
  );

  if (variant === 'mobile') {
    return (
      <BankTransactionFilterSection label='Booking date'>
        <div
          className='overflow-hidden rounded-md border bg-background'
          data-testid='bank-transaction-mobile-calendar'
        >
          {calendar}
          {filters.bookingDate !== undefined && (
            <>
              <Separator className='w-full' />
              <div className='p-1'>
                <Button className='h-10 w-full rounded-sm' variant='ghost' onClick={handleReset}>
                  Reset
                </Button>
              </div>
            </>
          )}
        </div>
      </BankTransactionFilterSection>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={cn('h-12 sm:h-8', filters.bookingDate ? 'border' : 'border-dashed', className)}
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
        {calendar}
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
