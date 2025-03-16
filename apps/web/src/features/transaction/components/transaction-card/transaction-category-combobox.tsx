import {Check, ChevronDown} from 'lucide-react';
import {useState} from 'react';

import {CategoryBadge} from '@/components/shared/category-badge';
import {Button} from '@/components/ui/button';
import {Command, CommandGroup, CommandItem, CommandList} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Category} from '@/types/category';
import {Transaction} from '@/types/transaction';
import {cn} from '@/utils/cn';

import {usePatchTransaction} from '../../api/use-patch-transaction';

type TransactionCategoryComboboxProps = {
  transaction: Transaction;
};

export function TransactionCategoryCombobox({transaction}: TransactionCategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category>(transaction.category);

  const {patchTransaction} = usePatchTransaction();

  const handleCategorySelect = (category: Category) => {
    if (category !== selectedCategory) {
      setSelectedCategory(category);
      patchTransaction({id: transaction.id, patchDto: {category}});
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='outline' role='combobox' aria-expanded={open} className='pl-2'>
          <CategoryBadge category={selectedCategory} variant='lg' />
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[15rem] p-0' align='start'>
        <Command>
          <CommandList>
            <CommandGroup>
              {Object.values(Category).map((category) => (
                <CommandItem
                  key={category}
                  value={category}
                  className={cn(
                    'flex justify-between',
                    selectedCategory === category && 'bg-accent',
                  )}
                  onSelect={() => handleCategorySelect(category)}
                >
                  <CategoryBadge category={category} variant='lg' />
                  <Check
                    className={cn(
                      'h-4 w-4',
                      selectedCategory === category ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
