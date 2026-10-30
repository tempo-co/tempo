import {
  BANK_TRANSACTION_CATEGORIZATION_SOURCES,
  BankTransactionCategorizationSource,
} from '@tempo/contracts';
import {Sparkles} from 'lucide-react';

import {Command, CommandGroup, CommandItem, CommandList} from '@/components/ui/command';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {formatBankTransactionCategorySource} from '../utils/formatters';
import {FacetedFilter, FilterResetGroup} from './bank-transaction-faceted-filter';
import {FilterCheckIndicator, SelectedFilterSummary} from './bank-transaction-multi-select-filter';

type BankTransactionCategorySourceFilterProps = {
  filters: BankTransactionFilterParams;
  variant?: 'popover' | 'mobile';
  className?: string;
};

function getSourceLabel(source: BankTransactionCategorizationSource) {
  return formatBankTransactionCategorySource(source) ?? source;
}

export function BankTransactionCategorySourceFilter({
  filters,
  variant = 'popover',
  className,
}: BankTransactionCategorySourceFilterProps) {
  const {
    selectedValues,
    toggle: handleSelect,
    reset: handleReset,
  } = useBankTransactionArrayFilter(filters, 'categorySources');

  const sourceCommand = (
    <Command>
      <CommandList>
        <CommandGroup>
          {BANK_TRANSACTION_CATEGORIZATION_SOURCES.map((source) => {
            const isSelected = selectedValues.includes(source);
            return (
              <CommandItem
                key={source}
                value={getSourceLabel(source)}
                onSelect={() => handleSelect(source)}
              >
                <FilterCheckIndicator isSelected={isSelected} />
                <span className='truncate'>{getSourceLabel(source)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <FilterResetGroup show={selectedValues.length > 0} onReset={handleReset} />
      </CommandList>
    </Command>
  );

  return (
    <FacetedFilter
      variant={variant}
      label='Category source'
      icon={<Sparkles />}
      isActive={selectedValues.length > 0}
      summary={
        <SelectedFilterSummary
          items={selectedValues.map((value) => ({key: value, label: getSourceLabel(value)}))}
        />
      }
      ariaLabel='Category source'
      contentClassName='w-[240px] p-0'
      className={className}
    >
      {sourceCommand}
    </FacetedFilter>
  );
}
