import {useNavigate} from '@tanstack/react-router';
import {isSameDay, startOfDay, startOfYear, subYears} from 'date-fns';
import {useState} from 'react';
import {DateRange} from 'react-day-picker';

import {buttonVariants} from '@/components/ui/button';
import {Calendar} from '@/components/ui/calendar';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {cn} from '@/utils/cn';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {
  DATE_FILTER_HISTORY_YEARS,
  DATE_FILTER_PRESETS,
  DateFilterRange,
} from '../utils/date-filter-presets';

/** The Date filter's options inside "+ Add filter": quick ranges over a one-month range calendar. */
export function BankTransactionDateFilter({filters}: {filters: BankTransactionFilterParams}) {
  const navigate = useNavigate({from: '/transactions/'});
  const today = startOfDay(new Date());
  const [month, setMonth] = useState(() => filters.date?.from ?? today);

  const handleSelect = async (range: DateRange | undefined) => {
    const date = range?.from ? {from: range.from, to: range.to} : undefined;
    await navigate({
      search: (prev) => ({...prev, date}),
    });
  };

  const handlePresetSelect = async (range: DateFilterRange) => {
    setMonth(range.from);
    await handleSelect(range);
  };

  const activePreset = DATE_FILTER_PRESETS.find((preset) => {
    const range = preset.getRange(today);
    return (
      filters.date?.from !== undefined &&
      filters.date.to !== undefined &&
      isSameDay(filters.date.from, range.from) &&
      isSameDay(filters.date.to, range.to)
    );
  });

  return (
    <div
      className='overflow-hidden rounded-md border bg-background'
      data-testid='bank-transaction-mobile-calendar'
    >
      <ToggleGroup
        type='single'
        size='sm'
        aria-label='Quick ranges'
        orientation='horizontal'
        value={activePreset?.label ?? ''}
        // Choosing the range already in force again keeps it.
        onValueChange={(label) => {
          const preset = DATE_FILTER_PRESETS.find((candidate) => candidate.label === label);
          if (preset) void handlePresetSelect(preset.getRange(today));
        }}
        className='grid grid-cols-2 gap-1 border-b p-2 min-[360px]:grid-cols-3'
      >
        {DATE_FILTER_PRESETS.map((preset) => (
          <ToggleGroupItem
            key={preset.label}
            value={preset.label}
            className='h-10 px-2 font-normal data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground'
          >
            {preset.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Calendar
        className='w-full'
        classNames={{
          month: 'w-full space-y-4',
          head_row: 'flex w-full',
          head_cell: 'text-muted-foreground rounded-md flex-1 font-normal text-body-small',
          row: 'flex w-full mt-2',
          cell: 'h-11 min-w-0 flex-1 text-center text-body p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 has-aria-[selected]:bg-accent first:has-aria-[selected]:rounded-l-md last:has-aria-[selected]:rounded-r-md focus-within:relative focus-within:z-20',
          day: cn(
            buttonVariants({variant: 'ghost'}),
            'h-11 w-full max-sm:min-w-0 pointer-coarse:min-w-0 p-0 font-normal aria-selected:opacity-100',
          ),
        }}
        mode='range'
        captionLayout='dropdown-buttons'
        fromDate={startOfYear(subYears(today, DATE_FILTER_HISTORY_YEARS))}
        toDate={today}
        month={month}
        onMonthChange={setMonth}
        selected={filters.date as DateRange | undefined}
        onSelect={handleSelect}
        disabled={{after: today}}
      />
    </div>
  );
}
