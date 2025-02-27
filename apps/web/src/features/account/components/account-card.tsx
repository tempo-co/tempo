import {Link} from '@tanstack/react-router';
import {EllipsisVertical} from 'lucide-react';

import {DynamicBankIcon} from '@/components/shared/dynamic-bank-icon';
import {Account} from '@/types/account';

type AccountCardProps = {
  account: Account;
};

export function AccountCard({account}: AccountCardProps) {
  return (
    <Link to='/accounts/$accountId' params={{accountId: account.id}}>
      <div className='flex items-center justify-between p-4 hover:bg-card'>
        <div className='flex items-center'>
          <div className='rounded-md bg-muted p-2'>
            <DynamicBankIcon bank={account.bank} className='w-7 fill-foreground' />
          </div>
          <div className='ml-4 flex flex-col'>
            <div>
              {account.alias ? (
                <>
                  <p>{account.alias}</p>
                  <p className='text-muted-foreground'>{account.bank}</p>
                </>
              ) : (
                <p>{account.bank}</p>
              )}
            </div>
          </div>
        </div>
        <div className='flex gap-10'>
          <div>{account.balance}</div>
          <EllipsisVertical className='w-5' />
        </div>
      </div>
    </Link>
  );
}
