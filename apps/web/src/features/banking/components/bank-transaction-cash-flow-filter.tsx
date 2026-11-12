import {
  BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES,
  BankTransactionCashFlowFilterValue,
} from '@tempo/contracts';
import * as React from 'react';

import {Command, CommandGroup, CommandItem, CommandList} from '@/components/ui/command';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';
import {cn} from '@/utils/cn';

import {
  BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {CASH_FLOW_LABELS} from '../utils/drill-filters';
import {FilterCheckIndicator} from './bank-transaction-multi-select-filter';

type InternalKind = (typeof BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS)[number];

const isInternalKind = (value: BankTransactionCashFlowFilterValue): value is InternalKind =>
  (BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS as readonly string[]).includes(value);

/** The cash flow options for the Filters panel. */
export function BankTransactionCashFlowFilter({filters}: {filters: BankTransactionFilterParams}) {
  const {selectedValues, setSelectedValues} = useBankTransactionArrayFilter(filters, 'cashFlows');
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
  const selectionDescriptionId = React.useId();

  return (
    <Command>
      <CommandList>
        <CommandGroup>
          {BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES.map((eventType) => {
            const selection = getSelection(eventType);
            const isSelected = selection === true;
            return (
              <CommandItem
                key={eventType}
                value={CASH_FLOW_LABELS[eventType]}
                aria-describedby={`${selectionDescriptionId}-${eventType}`}
                data-filter-selected={selection}
                onSelect={() => void handleSelect(eventType)}
                // Currency exchanges and own transfers narrow Internal movements, so they sit under it.
                className={cn(isInternalKind(eventType) && 'pl-8')}
              >
                <FilterCheckIndicator isSelected={isSelected} isMixed={selection === 'mixed'} />
                <span className='truncate'>{CASH_FLOW_LABELS[eventType]}</span>
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
      </CommandList>
    </Command>
  );
}
