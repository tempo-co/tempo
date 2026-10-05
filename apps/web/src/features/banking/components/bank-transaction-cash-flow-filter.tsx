import {ArrowLeftRight, ChevronDown} from 'lucide-react';
import * as React from 'react';

import {Button} from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';
import {cn} from '@/utils/cn';

import {
  BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES,
  BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS,
  BankTransactionCashFlowFilterValue,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {CASH_FLOW_LABELS} from '../utils/drill-filters';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';
import {FilterCheckIndicator, SelectedFilterSummary} from './bank-transaction-multi-select-filter';

type BankTransactionCashFlowFilterProps = {
  filters: BankTransactionFilterParams;
  variant?: 'popover' | 'mobile';
  className?: string;
};

function getEventLabel(eventType: BankTransactionCashFlowFilterValue) {
  return CASH_FLOW_LABELS[eventType];
}

type InternalKind = (typeof BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS)[number];

const isInternalKind = (value: BankTransactionCashFlowFilterValue): value is InternalKind =>
  (BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS as readonly string[]).includes(value);

export function BankTransactionCashFlowFilter({
  filters,
  variant = 'popover',
  className,
}: BankTransactionCashFlowFilterProps) {
  const {
    selectedValues,
    setSelectedValues,
    reset: handleReset,
  } = useBankTransactionArrayFilter(filters, 'cashFlows');
  const internalKinds = selectedValues.includes('INTERNAL')
    ? [...BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS]
    : BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS.filter((kind) => selectedValues.includes(kind));
  const getSelection = (value: BankTransactionCashFlowFilterValue) =>
    value === 'INTERNAL'
      ? internalKinds.length === 2
        ? true
        : internalKinds.length === 1
          ? 'mixed'
          : false
      : isInternalKind(value)
        ? internalKinds.includes(value)
        : selectedValues.includes(value);
  const handleSelect = (value: BankTransactionCashFlowFilterValue) => {
    if (value === 'INTERNAL' || isInternalKind(value)) {
      const otherFlows = selectedValues.filter(
        (selected) => selected !== 'INTERNAL' && !isInternalKind(selected),
      );
      const kinds =
        value === 'INTERNAL'
          ? internalKinds.length === 2
            ? []
            : [...BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS]
          : internalKinds.includes(value)
            ? internalKinds.filter((kind) => kind !== value)
            : [...internalKinds, value];
      return setSelectedValues([
        ...otherFlows,
        ...(kinds.length === 2 ? ['INTERNAL' as const] : kinds),
      ]);
    }
    return setSelectedValues(
      selectedValues.includes(value)
        ? selectedValues.filter((selected) => selected !== value)
        : [...selectedValues, value],
    );
  };
  const selectedLabels = selectedValues.map(getEventLabel);
  const selectionDescriptionId = React.useId();

  const eventCommand = (
    <Command>
      <CommandList>
        <CommandGroup>
          {BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES.map((eventType) => {
            const selection = getSelection(eventType);
            const isSelected = selection === true;
            return (
              <CommandItem
                key={eventType}
                value={getEventLabel(eventType)}
                aria-describedby={`${selectionDescriptionId}-${eventType}`}
                data-filter-selected={selection}
                onSelect={() => void handleSelect(eventType)}
                // Currency exchanges and own transfers narrow Internal movements, so they sit under it.
                className={cn(isInternalKind(eventType) && 'pl-8')}
              >
                <FilterCheckIndicator isSelected={isSelected} isMixed={selection === 'mixed'} />
                <span className='truncate'>{getEventLabel(eventType)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        {BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES.map((eventType) => (
          <span key={eventType} id={`${selectionDescriptionId}-${eventType}`} className='sr-only'>
            {getSelection(eventType) === 'mixed'
              ? 'Partially selected'
              : getSelection(eventType)
                ? 'Selected'
                : 'Not selected'}
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
      <BankTransactionFilterSection label='Cash flow'>
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
            selectedLabels.length > 0 ? `Cash flow: ${selectedLabels.join(', ')}` : 'Cash flow'
          }
          className={cn(
            'h-12 sm:h-8',
            selectedValues.length === 0 ? 'border-dashed' : 'border',
            className,
          )}
        >
          <ArrowLeftRight />
          Cash flow
          <SelectedFilterSummary
            items={selectedValues.map((value, index) => ({
              key: value,
              label: selectedLabels[index],
            }))}
          />
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[240px] p-0' align='start'>
        {eventCommand}
      </PopoverContent>
    </Popover>
  );
}
