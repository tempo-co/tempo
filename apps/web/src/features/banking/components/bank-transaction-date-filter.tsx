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
};

export function BankTransactionDateFilter({filters, setFilters}: BankTransactionDateFilterProps) {
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={cn('h-8', filters.bookingDate ? 'border' : 'border-dashed')}
        >
          <CalendarIcon />
          Booking date
          {filters.bookingDate?.from && (
            <>
              <Separator orientation='vertical' className='mx-2 h-4' />
              <span className='text-secondary-foreground'>
                {format(filters.bookingDate.from, 'MMM dd, y')}
                {filters.bookingDate.to && <> - {format(filters.bookingDate.to, 'MMM dd, y')}</>}
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
              <Button className='h-8 w-full rounded-sm' variant='ghost' onClick={handleReset}>
                Reset
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
