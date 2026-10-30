import {useNavigate} from '@tanstack/react-router';
import {format, isSameDay, startOfDay, startOfYear, subYears} from 'date-fns';
import {CalendarIcon} from 'lucide-react';
import {useState} from 'react';
import {DateRange} from 'react-day-picker';

import {Button, buttonVariants} from '@/components/ui/button';
import {Calendar} from '@/components/ui/calendar';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/utils/cn';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {
  BOOKING_DATE_HISTORY_YEARS,
  BOOKING_DATE_PRESETS,
  BookingDateRange,
} from '../utils/booking-date-presets';
import {FacetedFilter} from './bank-transaction-faceted-filter';

type BankTransactionDateFilterProps = {
  filters: BankTransactionFilterParams;
  variant?: 'popover' | 'mobile';
  className?: string;
};

export function BankTransactionDateFilter({
  filters,
  variant = 'popover',
  className,
}: BankTransactionDateFilterProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const today = startOfDay(new Date());
  const [month, setMonth] = useState(() => filters.bookingDate?.from ?? today);

  const handleSelect = async (range: DateRange | undefined) => {
    const bookingDate = range?.from ? {from: range.from, to: range.to} : undefined;
    await navigate({
      search: (prev) => ({...prev, bookingDate, pageIndex: 0}),
    });
  };

  const handlePresetSelect = async (range: BookingDateRange) => {
    setMonth(range.from);
    await handleSelect(range);
  };

  const handleOpenChange = (open: boolean) => {
    if (open) setMonth(filters.bookingDate?.from ?? today);
  };

  const handleReset = async () => {
    await navigate({search: (prev) => ({...prev, bookingDate: undefined, pageIndex: 0})});
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

  const presets = (
    <div
      role='group'
      aria-label='Quick ranges'
      className={
        variant === 'mobile'
          ? 'grid grid-cols-2 gap-1 border-b p-2 min-[360px]:grid-cols-3'
          : 'flex w-36 flex-col gap-0.5 border-r p-2'
      }
    >
      {BOOKING_DATE_PRESETS.map((preset) => {
        const range = preset.getRange(today);
        const isActive =
          filters.bookingDate?.from !== undefined &&
          filters.bookingDate.to !== undefined &&
          isSameDay(filters.bookingDate.from, range.from) &&
          isSameDay(filters.bookingDate.to, range.to);
        return (
          <Button
            key={preset.label}
            variant={isActive ? 'secondary' : 'ghost'}
            size='sm'
            aria-pressed={isActive}
            className={cn(
              'font-normal',
              variant === 'mobile' ? 'h-10 px-2 text-xs' : 'h-8 justify-start px-2',
            )}
            onClick={() => handlePresetSelect(range)}
          >
            {preset.label}
          </Button>
        );
      })}
    </div>
  );

  const calendar = (
    <Calendar
      className={variant === 'mobile' ? 'w-full' : undefined}
      classNames={
        variant === 'mobile'
          ? {
              month: 'w-full space-y-4',
              head_row: 'flex w-full',
              head_cell: 'text-muted-foreground rounded-md flex-1 font-normal text-xs',
              row: 'flex w-full mt-2',
              cell: 'h-11 min-w-0 flex-1 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 has-aria-[selected]:bg-accent first:has-aria-[selected]:rounded-l-md last:has-aria-[selected]:rounded-r-md focus-within:relative focus-within:z-20',
              day: cn(
                buttonVariants({variant: 'ghost'}),
                'h-11 w-full max-sm:min-w-0 pointer-coarse:min-w-0 p-0 font-normal aria-selected:opacity-100',
              ),
            }
          : undefined
      }
      initialFocus
      mode='range'
      captionLayout='dropdown-buttons'
      fromDate={startOfYear(subYears(today, BOOKING_DATE_HISTORY_YEARS))}
      toDate={today}
      month={month}
      onMonthChange={setMonth}
      selected={filters.bookingDate as DateRange | undefined}
      onSelect={handleSelect}
      disabled={{after: today}}
    />
  );

  return (
    <FacetedFilter
      variant={variant}
      label='Booking date'
      icon={<CalendarIcon />}
      isActive={!!filters.bookingDate}
      summary={
        fullBookingDateLabel && (
          <>
            <Separator orientation='vertical' className='mx-2 h-4' />
            <span className='min-w-0 truncate text-secondary-foreground max-md:flex-1'>
              <span className='max-md:hidden'>{fullBookingDateLabel}</span>
              <span className='hidden max-md:inline'>{compactBookingDateLabel}</span>
            </span>
          </>
        )
      }
      ariaLabel={fullBookingDateLabel ? `Booking date: ${fullBookingDateLabel}` : undefined}
      contentClassName='w-auto p-0'
      className={className}
      onOpenChange={handleOpenChange}
      mobileContent={
        <div
          className='overflow-hidden rounded-md border bg-background'
          data-testid='bank-transaction-mobile-calendar'
        >
          {presets}
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
      }
    >
      <div className='flex'>
        {presets}
        {calendar}
      </div>
      {filters.bookingDate !== undefined && (
        <>
          <Separator className='w-full' />
          <div className='p-1'>
            <Button className='h-10 w-full rounded-sm sm:h-8' variant='ghost' onClick={handleReset}>
              Reset
            </Button>
          </div>
        </>
      )}
    </FacetedFilter>
  );
}
