import {useNavigate} from '@tanstack/react-router';
import {Check, ChevronDown, Landmark, Loader} from 'lucide-react';
import * as React from 'react';

import {BankIcon} from '@/components/shared/bank-icon';
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
import {useGetAllBankAccounts} from '@/features/bank-account/api/use-get-all-accounts';
import {BankAccount} from '@/types/bank-account';
import {cn} from '@/utils/cn';

import {TransactionFilterParams} from '../../types/search-params';

type TransactionBankAccountFilterProps = {
  filters: TransactionFilterParams;
  setFilters: React.Dispatch<React.SetStateAction<TransactionFilterParams>>;
};

export function TransactionBankAccountFilter({
  filters,
  setFilters,
}: TransactionBankAccountFilterProps) {
  const navigate = useNavigate({from: '/transactions'});

  const {bankAccounts, isPending} = useGetAllBankAccounts();

  const selectedValues = filters.bankAccountIds || [];

  const handleSelect = async (account: BankAccount) => {
    const isSelected = selectedValues.includes(account.id);
    const newSelectedValues = isSelected
      ? selectedValues.filter((id) => id !== account.id)
      : [...selectedValues, account.id];

    await navigate({
      search: (prev) => ({
        ...prev,
        bankAccountIds: newSelectedValues.length === 0 ? undefined : newSelectedValues,
      }),
    });
    setFilters((prev) => ({...prev, bankAccountIds: newSelectedValues}));
  };

  const handleReset = async () => {
    await navigate({search: (prev) => ({...prev, bankAccountIds: undefined})});
    setFilters((prev) => ({...prev, bankAccountIds: []}));
  };

  const isDisabled = isPending || !bankAccounts || bankAccounts.length === 0;

  const selectedAccounts = bankAccounts?.filter((acc) => selectedValues.includes(acc.id)) || [];

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
            <Loader className='mr-2 h-4 w-4 animate-slow-spin' />
          ) : (
            <Landmark className='mr-2 h-4 w-4' />
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
                    <div
                      className='flex items-center rounded bg-accent px-[6px] py-[3px]'
                      key={account.id}
                    >
                      <BankIcon bank={account.bank} className='mr-1 h-4 w-4' />
                      <span className='text-xs'>{account.alias || account.bank}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
          <ChevronDown className='text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[220px] p-0' align='start'>
        <Command>
          <ScrollArea className='h-fit max-h-[200px]'>
            <CommandList>
              <CommandEmpty>No bank accounts found.</CommandEmpty>
              <CommandGroup>
                {bankAccounts?.map((account) => {
                  const isSelected = selectedValues.includes(account.id);
                  return (
                    <CommandItem
                      key={account.id}
                      value={account.id}
                      onSelect={() => handleSelect(account)}
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
                      <BankIcon bank={account.bank} className='mr-1 h-4 w-4' />
                      <span>{account.alias || account.bank}</span>
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
