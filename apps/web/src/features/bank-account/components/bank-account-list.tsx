import {Landmark} from 'lucide-react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Skeleton} from '@/components/ui/skeleton';
import {BankAccount} from '@/types/bank-account';

import {BankAccountAddDialog} from './bank-account-add/bank-account-add-dialog';
import {BankAccountCard} from './bank-account-card';

type BankAccountListProps = {
  bankAccounts: BankAccount[];
  isPending: boolean;
};

export function BankAccountList({bankAccounts, isPending}: BankAccountListProps) {
  if (isPending) {
    return <Skeleton className='h-[22rem] w-full rounded-lg bg-card' />;
  }

  if (!isPending && bankAccounts.length === 0) {
    return (
      <EmptyState
        icon={Landmark}
        title='Add your first bank account'
        description='Create a bank account to upload statements and begin tracking your transactions.'
      >
        <BankAccountAddDialog />
      </EmptyState>
    );
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='mb-4 flex items-end justify-between'>
        <h1 className='text-2xl font-semibold'>Bank Accounts</h1>
        {bankAccounts && bankAccounts.length !== 0 && <BankAccountAddDialog />}
      </div>
      {bankAccounts?.map((bankAccount) => (
        <BankAccountCard key={bankAccount.id} bankAccount={bankAccount} />
      ))}
    </div>
  );
}
