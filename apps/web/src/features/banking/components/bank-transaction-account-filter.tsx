import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {useBankTransactionArrayFilter} from '@/hooks/use-bank-transaction-array-filter';

import {useActiveBankAccounts} from '../api/use-active-bank-accounts';
import {BankTransactionFilterParams} from '../types/bank-transaction';
import {BankAccountLabel} from './bank-account-label';
import {FilterCheckIndicator} from './bank-transaction-multi-select-filter';

/**
 * The account options for the Filters panel. With one known account there is nothing to choose, so the panel leaves
 * the filter out (`showsAccountFilter`); while accounts load or fail, it says so instead.
 */
export function BankTransactionAccountFilter({filters}: {filters: BankTransactionFilterParams}) {
  const {accounts, needsAccountName, isPending, isError} = useActiveBankAccounts();
  const {selectedValues, toggle: handleSelect} = useBankTransactionArrayFilter(
    filters,
    'bankAccountIds',
  );

  if (isPending || isError || accounts.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        {isPending ? 'Loading bank accounts...' : 'Bank accounts are unavailable.'}
      </p>
    );
  }

  return (
    <Command>
      <CommandInput placeholder='Search bank accounts...' />
      <CommandList className='max-h-none overflow-visible'>
        <CommandEmpty>No bank accounts found.</CommandEmpty>
        <CommandGroup>
          {accounts.map((account) => (
            <CommandItem
              key={account.id}
              value={`${account.label} ${account.bankName} ${account.currency}`}
              onSelect={() => handleSelect(account.id)}
            >
              <FilterCheckIndicator isSelected={selectedValues.includes(account.id)} />
              <BankAccountLabel
                bankName={account.bankName}
                currency={account.currency}
                accountName={needsAccountName(account.id) ? account.label : undefined}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
