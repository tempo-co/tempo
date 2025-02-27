import React from 'react';

import {Separator} from '@/components/ui/separator';
import {Account} from '@/types/account';

import {AccountAddDialog} from './account-add/account-add-dialog';
import {AccountCard} from './account-card';

type AccountListProps = {
  accounts: Account[];
};

export function AccountList({accounts}: AccountListProps) {
  return (
    <>
      <div className='flex flex-col'>
        {accounts?.map((account, index) => (
          <React.Fragment key={account.id}>
            <AccountCard account={account} />
            {index !== accounts.length - 1 && <Separator />}
          </React.Fragment>
        ))}
      </div>
      <AccountAddDialog />
    </>
  );
}
