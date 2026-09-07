import {useNavigate} from '@tanstack/react-router';
import {Check, ChevronDown, Landmark, Loader} from 'lucide-react';
import * as React from 'react';
import {useMemo} from 'react';

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

import {useGetAllBankConnections} from '../api/use-get-all-bank-connections';
import {BankTransactionFilterParams} from '../types/bank-transaction';

type BankTransactionAccountFilterProps = {
  filters: BankTransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<BankTransactionFilterParams>>;
};

type AccountOption = {
  id: string;
  label: string;
  bankName: string;
  currency: string;
};

export function BankTransactionAccountFilter({
  filters,
  setFilters,
}: BankTransactionAccountFilterProps) {
  const navigate = useNavigate({from: '/bank-transactions/'});
  const {bankConnections, isPending} = useGetAllBankConnections();
  const selectedValues = filters.bankAccountIds || [];

  const accounts = useMemo<AccountOption[]>(
    () =>
      bankConnections?.flatMap((connection) =>
        connection.bankAccounts.map((account) => ({
          id: account.id,
          label: account.alias || account.name || 'Bank account',
          bankName: connection.aspspName,
          currency: account.currency,
        })),
      ) || [],
    [bankConnections],
  );

  const selectedAccounts = accounts.filter((account) => selectedValues.includes(account.id));

  const handleSelect = async (accountId: string) => {
    const newSelectedValues = selectedValues.includes(accountId)
      ? selectedValues.filter((id) => id !== accountId)
      : [...selectedValues, accountId];

    await navigate({
      search: (prev) => ({
        ...prev,
        bankAccountIds: newSelectedValues.length === 0 ? undefined : newSelectedValues,
        pageIndex: 0,
      }),
    });
    setFilters((prev) => ({...prev, bankAccountIds: newSelectedValues}));
  };

  const handleReset = async () => {
    await navigate({search: (prev) => ({...prev, bankAccountIds: undefined, pageIndex: 0})});
    setFilters((prev) => ({...prev, bankAccountIds: []}));
  };

  const isDisabled = isPending || accounts.length === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          disabled={isDisabled}
          className={cn(
            'h-8',
            selectedValues.length === 0 && !isDisabled ? 'border-dashed' : 'border',
            isDisabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {isPending ? (
            <Loader className='mr-2 animate-slow-spin' />
          ) : (
            <Landmark className='mr-2' />
          )}
          Bank accounts
          {selectedAccounts.length > 0 && !isDisabled && (
            <>
              <Separator orientation='vertical' className='mx-2 h-4' />
              <Badge variant='secondary' className='rounded-sm px-1 font-normal lg:hidden'>
                {selectedAccounts.length}
              </Badge>
              <div className='hidden space-x-1 lg:flex'>
                {selectedAccounts.length > 2 ? (
                  <Badge variant='secondary' className='rounded-sm px-2 font-normal'>
                    {selectedAccounts.length} selected
                  </Badge>
                ) : (
                  selectedAccounts.map((account) => (
                    <span className='rounded bg-accent px-1.5 py-0.5 text-xs' key={account.id}>
                      {account.label}
                    </span>
                  ))
                )}
              </div>
            </>
          )}
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[260px] p-0' align='start'>
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
      </PopoverContent>
    </Popover>
  );
}
