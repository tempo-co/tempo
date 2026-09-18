import {useNavigate} from '@tanstack/react-router';
import {Check, ChevronDown, RefreshCw} from 'lucide-react';
import * as React from 'react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/utils/cn';

import {
  BANK_TRANSACTION_FINANCIAL_EVENT_LABELS,
  BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
  BankTransactionFilterParams,
  BankTransactionFinancialEventType,
} from '../types/bank-transaction';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';

type BankTransactionFinancialEventFilterProps = {
  filters: BankTransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<BankTransactionFilterParams>>;
  variant?: 'popover' | 'mobile';
  className?: string;
};

function getEventLabel(eventType: BankTransactionFinancialEventType) {
  return BANK_TRANSACTION_FINANCIAL_EVENT_LABELS[eventType];
}

export function BankTransactionFinancialEventFilter({
  filters,
  setFilters,
  variant = 'popover',
  className,
}: BankTransactionFinancialEventFilterProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const selectedValues = filters.financialEventTypes || [];
  const selectedLabels = selectedValues.map(getEventLabel);
  const selectionDescriptionId = React.useId();

  const handleSelect = async (eventType: BankTransactionFinancialEventType) => {
    const newSelectedValues = selectedValues.includes(eventType)
      ? selectedValues.filter((selectedEventType) => selectedEventType !== eventType)
      : [...selectedValues, eventType];

    await navigate({
      search: (prev) => ({
        ...prev,
        financialEventTypes: newSelectedValues.length === 0 ? undefined : newSelectedValues,
        pageIndex: 0,
      }),
    });
    setFilters((prev) => ({...prev, financialEventTypes: newSelectedValues}));
  };

  const handleReset = async () => {
    await navigate({search: (prev) => ({...prev, financialEventTypes: undefined, pageIndex: 0})});
    setFilters((prev) => ({...prev, financialEventTypes: []}));
  };

  const eventCommand = (
    <Command>
      <CommandList>
        <CommandGroup>
          {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.map((eventType) => {
            const isSelected = selectedValues.includes(eventType);
            return (
              <CommandItem
                key={eventType}
                value={getEventLabel(eventType)}
                aria-describedby={`${selectionDescriptionId}-${eventType}`}
                data-filter-selected={isSelected}
                onSelect={() => void handleSelect(eventType)}
              >
                <div
                  className={cn(
                    'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'opacity-50 [&_svg]:invisible',
                  )}
                >
                  <Check />
                </div>
                <span className='truncate'>{getEventLabel(eventType)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.map((eventType) => (
          <span key={eventType} id={`${selectionDescriptionId}-${eventType}`} className='sr-only'>
            {selectedValues.includes(eventType) ? 'Selected' : 'Not selected'}
          </span>
        ))}
        {selectedValues.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => void handleReset()}
                className='justify-center text-center'
              >
                Reset
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );

  if (variant === 'mobile') {
    return (
      <BankTransactionFilterSection label='Activity'>
        <div className='overflow-hidden rounded-md border bg-background'>{eventCommand}</div>
      </BankTransactionFilterSection>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          aria-label={
            selectedLabels.length > 0 ? `Activity: ${selectedLabels.join(', ')}` : 'Activity'
          }
          className={cn(
            'h-12 sm:h-8',
            selectedValues.length === 0 ? 'border-dashed' : 'border',
            className,
          )}
        >
          <RefreshCw />
          Activity
          {selectedValues.length > 0 && (
            <>
              <Separator orientation='vertical' className='mx-2 h-4' />
              <Badge variant='secondary' className='rounded-sm px-1 font-normal lg:hidden'>
                {selectedValues.length}
              </Badge>
              <div className='hidden space-x-1 lg:flex'>
                {selectedValues.length > 2 ? (
                  <Badge variant='secondary' className='rounded-sm px-2 font-normal'>
                    {selectedValues.length} selected
                  </Badge>
                ) : (
                  selectedLabels.map((label, index) => (
                    <span
                      className='rounded bg-accent px-1.5 py-0.5 text-xs'
                      key={selectedValues[index]}
                    >
                      {label}
                    </span>
                  ))
                )}
              </div>
            </>
          )}
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[240px] p-0' align='start'>
        {eventCommand}
      </PopoverContent>
    </Popover>
  );
}
