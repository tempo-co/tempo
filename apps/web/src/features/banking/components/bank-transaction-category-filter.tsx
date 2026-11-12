import {BANK_TRANSACTION_CATEGORIES, BANK_TRANSACTION_UNCATEGORIZED} from '@tempo/contracts';
import {Tags} from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';

import {
  BANK_TRANSACTION_CATEGORY_LABELS,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {FilterCheckIndicator} from './bank-transaction-multi-select-filter';

/** The category options for the Filters panel, which scrolls them itself. */
export function BankTransactionCategoryFilter({filters}: {filters: BankTransactionFilterParams}) {
  const {selectedValues, toggle: handleSelect} = useBankTransactionArrayFilter(
    filters,
    'categories',
  );

  return (
    <Command>
      <CommandInput placeholder='Search categories...' />
      <CommandList className='max-h-none overflow-visible'>
        <CommandEmpty>No categories found.</CommandEmpty>
        <CommandGroup>
          <CommandItem
            value='Not categorized'
            onSelect={() => handleSelect(BANK_TRANSACTION_UNCATEGORIZED)}
          >
            <FilterCheckIndicator
              isSelected={selectedValues.includes(BANK_TRANSACTION_UNCATEGORIZED)}
              className='mr-1'
            />
            <Tags className='h-5 w-5 text-muted-foreground' />
            <span className='truncate'>Not categorized</span>
          </CommandItem>
          {BANK_TRANSACTION_CATEGORIES.map((category) => {
            const isSelected = selectedValues.includes(category);
            return (
              <CommandItem
                key={category}
                value={BANK_TRANSACTION_CATEGORY_LABELS[category]}
                onSelect={() => handleSelect(category)}
              >
                <FilterCheckIndicator isSelected={isSelected} className='mr-1' />
                <BankTransactionCategoryIcon category={category} className='h-5 w-5' />
                <span className='truncate'>{BANK_TRANSACTION_CATEGORY_LABELS[category]}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
