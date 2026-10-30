import {Landmark, Loader} from 'lucide-react';

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

import {useActiveBankAccounts} from '../api/use-active-bank-accounts';
import {BankTransactionFilterParams} from '../types/bank-transaction';
import {formatBankAccountLabel} from '../utils/bank-account-label';
import {BankAccountLabel} from './bank-account-label';
import {FacetedFilter, FilterResetGroup} from './bank-transaction-faceted-filter';
import {FilterCheckIndicator, SelectedFilterSummary} from './bank-transaction-multi-select-filter';

type BankTransactionAccountFilterProps = {
  filters: BankTransactionFilterParams;
  variant?: 'popover' | 'mobile';
  className?: string;
};

export function BankTransactionAccountFilter({
  filters,
  variant = 'popover',
  className,
}: BankTransactionAccountFilterProps) {
  const {accounts, needsAccountName, isPending, isError} = useActiveBankAccounts();
  const {
    selectedValues,
    toggle: handleSelect,
    reset: handleReset,
  } = useBankTransactionArrayFilter(filters, 'bankAccountIds');

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
                  <BankAccountLabel
                    bankName={account.bankName}
                    currency={account.currency}
                    accountName={needsAccountName(account) ? account.label : undefined}
                  />
                </CommandItem>
              );
            })}
          </CommandGroup>
          <FilterResetGroup show={selectedValues.length > 0} onReset={handleReset} />
        </CommandList>
      </ScrollArea>
    </Command>
  );

  return (
    <FacetedFilter
      variant={variant}
      label='Bank accounts'
      icon={
        isPending ? <Loader className='mr-2 animate-slow-spin' /> : <Landmark className='mr-2' />
      }
      isActive={selectedValues.length > 0}
      summary={
        !isDisabled && (
          <SelectedFilterSummary
            items={selectedAccounts.map((account) => ({
              key: account.id,
              label: needsAccountName(account) ? account.label : formatBankAccountLabel(account),
            }))}
          />
        )
      }
      disabled={isDisabled}
      contentClassName='w-[260px] p-0'
      className={className}
      mobileContent={
        isDisabled ? (
          <p className='text-sm text-muted-foreground'>
            {isPending ? 'Loading bank accounts...' : 'Bank accounts are unavailable.'}
          </p>
        ) : undefined
      }
    >
      {accountCommand}
    </FacetedFilter>
  );
}
