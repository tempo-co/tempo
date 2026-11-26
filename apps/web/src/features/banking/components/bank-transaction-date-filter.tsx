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
  DATE_FILTER_HISTORY_YEARS,
  DATE_FILTER_PRESETS,
  DateFilterRange,
} from '../utils/date-filter-presets';
import {FacetedFilter} from './bank-transaction-faceted-filter';

type BankTransactionDateFilterProps = {
  filters: BankTransactionFilterParams;
  variant?: 'popover' | 'pane';
  className?: string;
};

export function BankTransactionDateFilter({
  filters,
  variant = 'popover',
  className,
}: BankTransactionDateFilterProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
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

  const handleOpenChange = (open: boolean) => {
    if (open) setMonth(filters.date?.from ?? today);
  };

  const handleReset = async () => {
    await navigate({search: (prev) => ({...prev, date: undefined})});
  };

  const dateFrom = filters.date?.from;
  const dateTo = filters.date?.to;
  const fullDateLabel = dateFrom
    ? `${format(dateFrom, 'MMM dd, y')}${dateTo ? ` - ${format(dateTo, 'MMM dd, y')}` : ''}`
    : undefined;
  const compactDateLabel = dateFrom
    ? `${format(dateFrom, 'MMM d')}${
        dateTo
          ? `–${format(
              dateTo,
              dateFrom.getFullYear() === dateTo.getFullYear() &&
                dateFrom.getMonth() === dateTo.getMonth()
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
        variant === 'pane'
          ? 'grid grid-cols-2 gap-1 border-b p-2 min-[360px]:grid-cols-3'
          : 'flex w-36 flex-col gap-0.5 border-r p-2'
      }
    >
      {DATE_FILTER_PRESETS.map((preset) => {
        const range = preset.getRange(today);
        const isActive =
          filters.date?.from !== undefined &&
          filters.date.to !== undefined &&
          isSameDay(filters.date.from, range.from) &&
          isSameDay(filters.date.to, range.to);
        return (
          <Button
            key={preset.label}
            variant={isActive ? 'secondary' : 'ghost'}
            size='sm'
            aria-pressed={isActive}
            className={cn(
              'font-normal',
              variant === 'pane' ? 'h-10 px-2 text-xs' : 'h-8 justify-start px-2',
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
      className={variant === 'pane' ? 'w-full' : undefined}
      classNames={
        variant === 'pane'
          ? {
              month: 'w-full space-y-4',
              head_row: 'flex w-full',
              head_cell: 'text-muted-foreground rounded-md flex-1 font-normal text-xs',
              row: 'flex w-full mt-2',
              cell: 'h-11 min-w-0 flex-1 text-center text-body p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 has-aria-[selected]:bg-accent first:has-aria-[selected]:rounded-l-md last:has-aria-[selected]:rounded-r-md focus-within:relative focus-within:z-20',
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
      fromDate={startOfYear(subYears(today, DATE_FILTER_HISTORY_YEARS))}
      toDate={today}
      month={month}
      onMonthChange={setMonth}
      selected={filters.date as DateRange | undefined}
      onSelect={handleSelect}
      disabled={{after: today}}
    />
  );

  return (
    <FacetedFilter
      variant={variant}
      label='Date'
      icon={<CalendarIcon />}
      isActive={!!filters.date}
      summary={
        fullDateLabel && (
          <>
            <Separator orientation='vertical' className='mx-2 h-4' />
            <span className='min-w-0 truncate text-secondary-foreground max-md:flex-1'>
              <span className='max-md:hidden'>{fullDateLabel}</span>
              <span className='hidden max-md:inline'>{compactDateLabel}</span>
            </span>
          </>
        )
      }
      ariaLabel={fullDateLabel ? `Date: ${fullDateLabel}` : undefined}
      contentClassName='w-auto p-0'
      className={className}
      onOpenChange={handleOpenChange}
      paneContent={
        <div
          className='overflow-hidden rounded-md border bg-background'
          data-testid='bank-transaction-mobile-calendar'
        >
          {presets}
          {calendar}
        </div>
      }
    >
      <div className='flex'>
        {presets}
        {calendar}
      </div>
      {filters.date !== undefined && (
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
