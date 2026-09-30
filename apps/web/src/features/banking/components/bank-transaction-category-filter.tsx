import {ChevronDown, Tags} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {ScrollArea} from '@/components/ui/scroll-area';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';
import {cn} from '@/utils/cn';

import {
  BANK_TRANSACTION_CATEGORIES,
  BANK_TRANSACTION_CATEGORY_LABELS,
  BANK_TRANSACTION_UNCATEGORIZED,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';
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
    label:
      value === BANK_TRANSACTION_UNCATEGORIZED
        ? 'Not categorized'
        : BANK_TRANSACTION_CATEGORY_LABELS[value],
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
        {selectedValues.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem onSelect={handleReset} className='justify-center text-center'>
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
      <BankTransactionFilterSection label='Categories'>
        <div className='overflow-hidden rounded-md border bg-background'>{categoryCommand}</div>
      </BankTransactionFilterSection>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          aria-label='Categories'
          className={cn(
            'h-12 sm:h-8',
            selectedValues.length === 0 ? 'border-dashed' : 'border',
            className,
          )}
        >
          <Tags />
          Categories
          <SelectedFilterSummary items={selectedItems} />
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[280px] p-0' align='start'>
        {categoryCommand}
      </PopoverContent>
    </Popover>
  );
}
