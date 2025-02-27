import {useNavigate} from '@tanstack/react-router';
import {format} from 'date-fns';
import {CalendarIcon} from 'lucide-react';
import * as React from 'react';
import {DateRange} from 'react-day-picker';

import {Button} from '@/components/ui/button';
import {Calendar} from '@/components/ui/calendar';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Separator} from '@/components/ui/separator';

import {TransactionFilter} from '../api/use-get-all-transactions';

type TransactionDateFilterProps = {
  filters: TransactionFilter;
  setFilters: React.Dispatch<React.SetStateAction<TransactionFilter>>;
};

export function TransactionDateFilter({filters, setFilters}: TransactionDateFilterProps) {
  const navigate = useNavigate({from: '/transactions'});

  const handleSelect = async (range: DateRange | undefined) => {
    let startedAt;
    if (range?.from && range.to && range.from.getTime() === range.to.getTime()) {
      startedAt = undefined;
    } else if (range?.from) {
      startedAt = {from: range.from, to: range.to};
    } else {
      startedAt = undefined;
    }

    await navigate({search: (prev) => ({...prev, startedAt})});
    setFilters((prev) => ({...prev, startedAt}));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant='outline' size='sm' className='h-8 border-dashed'>
          <CalendarIcon />
          Started at
          {filters?.startedAt?.from && (
            <>
              <Separator orientation='vertical' className='mx-2 h-4' />
              <span className='text-secondary-foreground'>
                {' '}
                {format(filters?.startedAt?.from, 'LLL dd, y')}
                {filters?.startedAt?.to && <> - {format(filters?.startedAt?.to, 'LLL dd, y')}</>}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0' align='start'>
        <Calendar
          initialFocus
          mode='range'
          defaultMonth={filters?.startedAt?.from}
          selected={filters?.startedAt}
          onSelect={handleSelect}
          numberOfMonths={2}
          disabled={{after: new Date()}}
        />
      </PopoverContent>
    </Popover>
  );
}
