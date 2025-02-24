import {useNavigate} from '@tanstack/react-router';
import {Check, PlusCircle} from 'lucide-react';
import * as React from 'react';

import {CategoryBadge} from '@/components/shared/category-badge';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Separator} from '@/components/ui/separator';
import {Category} from '@/types/category';
import {cn} from '@/utils/cn';

import {TransactionFilter} from '../api/use-get-all-transactions';

interface TransactionCategoryFilterProps {
  filters: TransactionFilter;
  setFilters: React.Dispatch<React.SetStateAction<TransactionFilter>>;
}

export function TransactionCategoryFilter({filters, setFilters}: TransactionCategoryFilterProps) {
  const navigate = useNavigate({from: '/transactions'});

  const selectedValues = filters.categories || [];

  const handleSelect = async (option: Category) => {
    const isSelected = selectedValues.includes(option);
    const newSelectedValues = isSelected
      ? selectedValues.filter((value) => value !== option)
      : [...selectedValues, option];

    await navigate({search: (prev) => ({...prev, categories: newSelectedValues})});
    setFilters((prev) => ({...prev, categories: newSelectedValues}));
  };

  const handleClear = async () => {
    await navigate({search: (prev) => ({...prev, categories: []})});
    setFilters((prev) => ({...prev, categories: []}));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant='outline' size='sm' className='h-8 border-dashed'>
          <PlusCircle />
          Category
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
                  selectedValues.map((category) => (
                    <CategoryBadge key={category} category={category} />
                  ))
                )}
              </div>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[14rem] p-0' align='start'>
        <Command>
          <ScrollArea className='h-fit'>
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {Object.values(Category).map((option) => {
                  const isSelected = selectedValues.includes(option);
                  return (
                    <CommandItem key={option} onSelect={() => handleSelect(option)}>
                      <div
                        className={cn(
                          'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'opacity-50 [&_svg]:invisible',
                        )}
                      >
                        <Check />
                      </div>
                      <CategoryBadge category={option} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {selectedValues.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem onSelect={handleClear} className='justify-center text-center'>
                      Clear filters
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </ScrollArea>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
