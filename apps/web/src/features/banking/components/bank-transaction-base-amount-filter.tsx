import {useNavigate} from '@tanstack/react-router';
import {
  BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES,
  BankTransactionBaseAmountFilterValue,
} from '@tempo/contracts';
import {Coins} from 'lucide-react';
import * as React from 'react';

import {Command, CommandGroup, CommandItem, CommandList} from '@/components/ui/command';

import {useGetAllBankConnections} from '../api/use-get-all-bank-connections';
import {BankTransactionFilterParams} from '../types/bank-transaction';
import {FacetedFilter, FilterResetGroup} from './bank-transaction-faceted-filter';
import {FilterCheckIndicator, SelectedFilterSummary} from './bank-transaction-multi-select-filter';

const LABELS: Record<BankTransactionBaseAmountFilterValue, string> = {
  PRESENT: 'Available',
  MISSING: 'Not available yet',
};

type BankTransactionBaseAmountFilterProps = {
  filters: BankTransactionFilterParams;
  variant?: 'popover' | 'mobile';
  className?: string;
};

export function BankTransactionBaseAmountFilter({
  filters,
  variant = 'popover',
  className,
}: BankTransactionBaseAmountFilterProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const {bankConnections} = useGetAllBankConnections();
  const currency = bankConnections?.find((connection) => connection.baseCurrency)?.baseCurrency;
  const label = `Amount in ${currency ?? 'base currency'}`;
  const descriptionId = React.useId();
  const select = (value: BankTransactionBaseAmountFilterValue | undefined) =>
    void navigate({search: (prev) => ({...prev, baseAmount: value, pageIndex: 0})});
  const command = (
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
  return (
    <FacetedFilter
      variant={variant}
      label={label}
      icon={<Coins />}
      isActive={!!filters.baseAmount}
      summary={
        <SelectedFilterSummary
          items={
            filters.baseAmount ? [{key: filters.baseAmount, label: LABELS[filters.baseAmount]}] : []
          }
        />
      }
      ariaLabel={filters.baseAmount ? `${label}: ${LABELS[filters.baseAmount]}` : label}
      contentClassName='w-[240px] p-0'
      className={className}
    >
      {command}
    </FacetedFilter>
  );
}
