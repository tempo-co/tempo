import {useNavigate} from '@tanstack/react-router';
import {Check, ChevronDown, Sparkles} from 'lucide-react';
import * as React from 'react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/utils/cn';

import {
  BANK_TRANSACTION_CATEGORIZATION_SOURCES,
  BankTransactionCategorizationSource,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {formatBankTransactionCategorySource} from '../utils/formatters';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';

type BankTransactionCategorySourceFilterProps = {
  filters: BankTransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<BankTransactionFilterParams>>;
  variant?: 'popover' | 'mobile';
  className?: string;
};

function getSourceLabel(source: BankTransactionCategorizationSource) {
  return formatBankTransactionCategorySource(source) ?? source;
}

export function BankTransactionCategorySourceFilter({
  filters,
  setFilters,
  variant = 'popover',
  className,
}: BankTransactionCategorySourceFilterProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const selectedValues = filters.categorySources || [];
  const selectedLabels = selectedValues.map(getSourceLabel);

  const handleSelect = async (source: BankTransactionCategorizationSource) => {
    const newSelectedValues = selectedValues.includes(source)
      ? selectedValues.filter((selectedSource) => selectedSource !== source)
      : [...selectedValues, source];

    await navigate({
      search: (prev) => ({
        ...prev,
        categorySources: newSelectedValues.length === 0 ? undefined : newSelectedValues,
        pageIndex: 0,
      }),
    });
    setFilters((prev) => ({...prev, categorySources: newSelectedValues}));
  };

  const handleReset = async () => {
    await navigate({search: (prev) => ({...prev, categorySources: undefined, pageIndex: 0})});
    setFilters((prev) => ({...prev, categorySources: []}));
  };

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
                <span className='truncate'>{getSourceLabel(source)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
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
      <BankTransactionFilterSection label='Category source'>
        <div className='overflow-hidden rounded-md border bg-background'>{sourceCommand}</div>
      </BankTransactionFilterSection>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          aria-label='Category source'
          className={cn(
            'h-12 sm:h-8',
            selectedValues.length === 0 ? 'border-dashed' : 'border',
            className,
          )}
        >
          <Sparkles />
          Category source
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
      <PopoverContent className='w-[240px] p-0' align='start'>
        {sourceCommand}
      </PopoverContent>
    </Popover>
  );
}
