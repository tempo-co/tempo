import {useNavigate} from '@tanstack/react-router';
import {
  BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES,
  BankTransactionBaseAmountFilterValue,
} from '@tempo/contracts';
import * as React from 'react';

import {Command, CommandGroup, CommandItem, CommandList} from '@/components/ui/command';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {FilterResetGroup} from './bank-transaction-faceted-filter';
import {FilterCheckIndicator} from './bank-transaction-multi-select-filter';

const LABELS: Record<BankTransactionBaseAmountFilterValue, string> = {
  PRESENT: 'Available',
  MISSING: 'Not available yet',
};

/** The base-amount options for the Filters panel. */
export function BankTransactionBaseAmountFilter({filters}: {filters: BankTransactionFilterParams}) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const descriptionId = React.useId();
  const select = (value: BankTransactionBaseAmountFilterValue | undefined) =>
    void navigate({search: (prev) => ({...prev, baseAmount: value})});
  return (
    <Command>
      <CommandList>
        <CommandGroup>
          {BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES.map((value) => (
            <CommandItem
              key={value}
              value={LABELS[value]}
              data-filter-selected={filters.baseAmount === value}
              aria-describedby={`${descriptionId}-${value}`}
              onSelect={() => select(filters.baseAmount === value ? undefined : value)}
            >
              <FilterCheckIndicator isSelected={filters.baseAmount === value} />
              <span>{LABELS[value]}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES.map((value) => (
          <span key={value} id={`${descriptionId}-${value}`} className='sr-only'>
            {filters.baseAmount === value ? 'Selected' : 'Not selected'}
          </span>
        ))}
        <FilterResetGroup show={!!filters.baseAmount} onReset={() => select(undefined)} />
      </CommandList>
    </Command>
  );
}
