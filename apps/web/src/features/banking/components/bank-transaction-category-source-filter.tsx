import {
  BANK_TRANSACTION_CATEGORIZATION_SOURCES,
  BankTransactionCategorizationSource,
} from '@tempo/contracts';

import {Command, CommandGroup, CommandItem, CommandList} from '@/components/ui/command';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';

import {BankTransactionFilterParams} from '../types/bank-transaction';
import {formatBankTransactionCategorySource} from '../utils/formatters';
import {FilterCheckIndicator} from './bank-transaction-multi-select-filter';

function getSourceLabel(source: BankTransactionCategorizationSource) {
  return formatBankTransactionCategorySource(source) ?? source;
}

/** The category source options for the Filters panel. */
export function BankTransactionCategorySourceFilter({
  filters,
}: {
  filters: BankTransactionFilterParams;
}) {
  const {selectedValues, toggle: handleSelect} = useBankTransactionArrayFilter(
    filters,
    'categorySources',
  );

  return (
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
      </CommandList>
    </Command>
  );
}
