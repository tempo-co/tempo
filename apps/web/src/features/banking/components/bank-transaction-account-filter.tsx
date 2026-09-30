import {ChevronDown, Landmark, Loader} from 'lucide-react';
import {useMemo} from 'react';

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

import {useGetAllBankConnections} from '../api/use-get-all-bank-connections';
import {BankTransactionFilterParams} from '../types/bank-transaction';
import {resolveBankAccountLabel} from '../utils/formatters';
import {BankTransactionFilterSection} from './bank-transaction-filter-section';
import {FilterCheckIndicator, SelectedFilterSummary} from './bank-transaction-multi-select-filter';

type BankTransactionAccountFilterProps = {
  filters: BankTransactionFilterParams;
  variant?: 'popover' | 'mobile';
  className?: string;
};

type AccountOption = {
  id: string;
  label: string;
  bankName: string;
  currency: string;
};

export function BankTransactionAccountFilter({
  filters,
  variant = 'popover',
  className,
}: BankTransactionAccountFilterProps) {
  const {bankConnections, isPending, isError} = useGetAllBankConnections();
  const {
    selectedValues,
    toggle: handleSelect,
    reset: handleReset,
  } = useBankTransactionArrayFilter(filters, 'bankAccountIds');

  const accounts = useMemo<AccountOption[]>(
    () =>
      bankConnections?.flatMap((connection) =>
        connection.bankAccounts
          .filter((account) => account.isActive)
          .map((account) => ({
            id: account.id,
            label: resolveBankAccountLabel(account),
            bankName: connection.aspspName,
            currency: account.currency,
          })),
      ) || [],
    [bankConnections],
  );

  const selectedAccounts = accounts.filter((account) => selectedValues.includes(account.id));

  if (!isPending && !isError && accounts.length <= 1) return null;

  const isDisabled = isPending || isError || accounts.length === 0;
  const accountCommand = (
    <Command>
      <CommandInput placeholder='Search bank accounts...' />
      <ScrollArea className='h-fit max-h-[240px]'>
        <CommandList>
          <CommandEmpty>No bank accounts found.</CommandEmpty>
          <CommandGroup>
            {accounts.map((account) => {
              const isSelected = selectedValues.includes(account.id);
              return (
                <CommandItem
                  key={account.id}
                  value={`${account.label} ${account.bankName} ${account.currency}`}
                  onSelect={() => handleSelect(account.id)}
                >
                  <FilterCheckIndicator isSelected={isSelected} />
                  <div className='min-w-0'>
                    <p className='truncate'>{account.label}</p>
                    <p className='truncate text-xs text-muted-foreground'>
                      {account.bankName} | {account.currency}
                    </p>
                  </div>
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
      </ScrollArea>
    </Command>
  );

  if (variant === 'mobile') {
    return (
      <BankTransactionFilterSection label='Bank accounts'>
        {isDisabled ? (
          <p className='text-sm text-muted-foreground'>
            {isPending ? 'Loading bank accounts...' : 'Bank accounts are unavailable.'}
          </p>
        ) : (
          <div className='overflow-hidden rounded-md border bg-background'>{accountCommand}</div>
        )}
      </BankTransactionFilterSection>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          disabled={isDisabled}
          className={cn(
            'h-12 sm:h-8',
            selectedValues.length === 0 && !isDisabled ? 'border-dashed' : 'border',
            isDisabled && 'cursor-not-allowed opacity-50',
            className,
          )}
        >
          {isPending ? (
            <Loader className='mr-2 animate-slow-spin' />
          ) : (
            <Landmark className='mr-2' />
          )}
          Bank accounts
          {!isDisabled && (
            <SelectedFilterSummary
              items={selectedAccounts.map((account) => ({key: account.id, label: account.label}))}
            />
          )}
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[260px] p-0' align='start'>
        {accountCommand}
      </PopoverContent>
    </Popover>
  );
}
