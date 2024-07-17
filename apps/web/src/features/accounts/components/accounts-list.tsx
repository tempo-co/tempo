import React from 'react';

import {Separator} from '@/components/ui/separator';

import {useGetAllAccounts} from '../api/use-get-all-accounts';
import {AccountCard} from './account-card';
import {AccountsBreadcrumb} from './accounts-breadcrumb';
import {AddAccountDialog} from './add-account-dialog';

export function AccountsList() {
  const {accounts, isPending} = useGetAllAccounts();
  return (
    <>
      <AccountsBreadcrumb />
      {isPending ? (
        <p>Loading...</p>
      ) : (
        <div className='flex flex-col'>
          {accounts?.map((account, index) => (
            <React.Fragment key={account.id}>
              <AccountCard account={account} />
              {index !== accounts.length - 1 && <Separator />}
            </React.Fragment>
          ))}
        </div>
      )}
      <AddAccountDialog />
    </>
  );
}
