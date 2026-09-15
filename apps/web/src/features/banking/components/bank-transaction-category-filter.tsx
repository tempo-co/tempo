import {useNavigate} from '@tanstack/react-router';
import {Check, ChevronDown, Tags} from 'lucide-react';
import * as React from 'react';

import {Badge} from '@/components/ui/badge';
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
import {Separator} from '@/components/ui/separator';
import {cn} from '@/utils/cn';

import {
  BANK_TRANSACTION_CATEGORIES,
  BANK_TRANSACTION_CATEGORY_LABELS,
  BANK_TRANSACTION_UNCATEGORIZED,
  BankTransactionCategoryFilterValue,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';

type BankTransactionCategoryFilterProps = {
  filters: BankTransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<BankTransactionFilterParams>>;
  variant?: 'popover' | 'mobile';
  className?: string;
};

export function BankTransactionCategoryFilter({
  filters,
  setFilters,
  variant = 'popover',
  className,
}: BankTransactionCategoryFilterProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const selectedValues = filters.categories || [];
  const selectedLabels = selectedValues.map((value) =>
    value === BANK_TRANSACTION_UNCATEGORIZED
      ? 'Not categorized'
      : BANK_TRANSACTION_CATEGORY_LABELS[value],
  );

  const handleSelect = async (value: BankTransactionCategoryFilterValue) => {
    const newSelectedValues = selectedValues.includes(value)
      ? selectedValues.filter((selectedValue) => selectedValue !== value)
      : [...selectedValues, value];

    await navigate({
      search: (prev) => ({
        ...prev,
        categories: newSelectedValues.length === 0 ? undefined : newSelectedValues,
        pageIndex: 0,
      }),
    });
    setFilters((prev) => ({...prev, categories: newSelectedValues}));
  };

  const handleReset = async () => {
    await navigate({search: (prev) => ({...prev, categories: undefined, pageIndex: 0})});
    setFilters((prev) => ({...prev, categories: []}));
  };

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
              <div
                className={cn(
                  'mr-1 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                  selectedValues.includes(BANK_TRANSACTION_UNCATEGORIZED)
                    ? 'bg-primary text-primary-foreground'
                    : 'opacity-50 [&_svg]:invisible',
                )}
              >
                <Check />
              </div>
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
                  <div
                    className={cn(
                      'mr-1 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'opacity-50 [&_svg]:invisible',
                    )}
                  >
                    <Check />
                  </div>
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
          {selectedValues.length > 0 && (
            <>
              <Separator orientation='vertical' className='mx-2 h-4' />
              <Badge variant='secondary' className='rounded-sm px-1 font-normal lg:hidden'>
                {selectedValues.length}
              </Badge>
              <div className='hidden space-x-1 lg:flex'>
                {selectedValues.length > 2 ? (
                  <Badge variant='secondary' className='rounded-sm px-2 font-normal'>
                    {selectedValues.length} selected
                  </Badge>
                ) : (
                  selectedLabels.map((label, index) => (
                    <span
                      className='rounded bg-accent px-1.5 py-0.5 text-xs'
                      key={selectedValues[index]}
                    >
                      {label}
                    </span>
                  ))
                )}
              </div>
            </>
          )}
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[280px] p-0' align='start'>
        {categoryCommand}
      </PopoverContent>
    </Popover>
  );
}
