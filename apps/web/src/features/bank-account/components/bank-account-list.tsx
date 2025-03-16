import React from 'react';

import Wallet from '@/components/shared/illustrations/wallet';
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
    return <Skeleton className='mt-[5.5rem] h-[5.1rem] w-full rounded-lg bg-card' />;
  }

  if (!isPending && bankAccounts.length === 0) {
    return (
      <div className='mt-8 flex flex-col items-center'>
        <Wallet className='h-60' />
        <div className='mb-4 flex flex-col items-center text-base'>
          <p className='mb-2 text-2xl'>No bank accounts</p>
          <p className='text-muted-foreground'>You do not have any bank accounts yet.</p>
        </div>
        <BankAccountAddDialog />
      </div>
    );
  }

  return (
    <>
      <div className='mt-4 flex flex-col gap-3'>
        {bankAccounts?.map((bankAccount) => (
          <React.Fragment key={bankAccount.id}>
            <BankAccountCard bankAccount={bankAccount} />
          </React.Fragment>
        ))}
      </div>
    </>
  );
}
