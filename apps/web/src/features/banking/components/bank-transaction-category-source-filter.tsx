import {ChevronDown, Sparkles} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';
import {cn} from '@/utils/cn';

import {
  BANK_TRANSACTION_CATEGORIZATION_SOURCES,
  BankTransactionCategorizationSource,
  BankTransactionFilterParams,
} from '../types/bank-transaction';
import {formatBankTransactionCategorySource} from '../utils/formatters';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';
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
  const selectedLabels = selectedValues.map(getSourceLabel);

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
          <SelectedFilterSummary
            items={selectedValues.map((value, index) => ({
              key: value,
              label: selectedLabels[index],
            }))}
          />
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[240px] p-0' align='start'>
        {sourceCommand}
      </PopoverContent>
    </Popover>
  );
}
