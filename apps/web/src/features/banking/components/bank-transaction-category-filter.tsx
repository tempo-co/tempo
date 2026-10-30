import {Tags} from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {ScrollArea} from '@/components/ui/scroll-area';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';

import {
  BANK_TRANSACTION_CATEGORIES,
  BANK_TRANSACTION_CATEGORY_LABELS,
  BANK_TRANSACTION_UNCATEGORIZED,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {formatBankTransactionCategory} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {FacetedFilter, FilterResetGroup} from './bank-transaction-faceted-filter';
import {FilterCheckIndicator, SelectedFilterSummary} from './bank-transaction-multi-select-filter';

type BankTransactionCategoryFilterProps = {
  filters: BankTransactionFilterParams;
  variant?: 'popover' | 'mobile';
  className?: string;
};

export function BankTransactionCategoryFilter({
  filters,
  variant = 'popover',
  className,
}: BankTransactionCategoryFilterProps) {
  const {
    selectedValues,
    toggle: handleSelect,
    reset: handleReset,
  } = useBankTransactionArrayFilter(filters, 'categories');
  const selectedItems = selectedValues.map((value) => ({
    key: value,
    label: formatBankTransactionCategory(value),
  }));

  const categoryCommand = (
    <Command>
      <CommandInput placeholder='Search categories...' />
      <CommandList className='max-h-none overflow-visible'>
        <ScrollArea className={variant === 'mobile' ? 'h-[240px]' : 'h-[300px]'}>
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
        </ScrollArea>
        <FilterResetGroup show={selectedValues.length > 0} onReset={handleReset} />
      </CommandList>
    </Command>
  );

  return (
    <FacetedFilter
      variant={variant}
      label='Categories'
      icon={<Tags />}
      isActive={selectedValues.length > 0}
      summary={<SelectedFilterSummary items={selectedItems} />}
      ariaLabel='Categories'
      contentClassName='w-[280px] p-0'
      className={className}
    >
      {categoryCommand}
    </FacetedFilter>
  );
}
