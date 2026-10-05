import {useNavigate} from '@tanstack/react-router';
import {ChevronDown, Coins} from 'lucide-react';
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
import {cn} from '@/utils/cn';

import {useGetAllBankConnections} from '../api/use-get-all-bank-connections';
import {
  BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES,
  BankTransactionBaseAmountFilterValue,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';
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
        {filters.baseAmount && (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => select(undefined)}
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
      <BankTransactionFilterSection label={label}>
        <div className='overflow-hidden rounded-md border bg-background'>{command}</div>
      </BankTransactionFilterSection>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          aria-label={filters.baseAmount ? `${label}: ${LABELS[filters.baseAmount]}` : label}
          className={cn('h-12 sm:h-8', filters.baseAmount ? 'border' : 'border-dashed', className)}
        >
          <Coins />
          {label}
          <SelectedFilterSummary
            items={
              filters.baseAmount
                ? [{key: filters.baseAmount, label: LABELS[filters.baseAmount]}]
                : []
            }
          />
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[240px] p-0' align='start'>
        {command}
      </PopoverContent>
    </Popover>
  );
}
