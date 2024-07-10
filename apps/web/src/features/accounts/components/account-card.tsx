import {DynamicBankIcon} from '@/components/shared/dynamic-bank-icon';
import {Card} from '@/components/ui/card';
import {Account} from '@/types/account';

type AccountCardProps = {
  account: Account;
};

export function AccountCard({account}: AccountCardProps) {
  return (
    <Card className='p-4 w-96'>
      <div className='flex'>
        <DynamicBankIcon bank={account.bank} className='w-6' />
        <div className='grid ml-4'>
          <p>{account.bank}</p>
          <p className='text-muted-foreground'>{account.alias ? account.alias : 'no alias'}</p>
        </div>
      </div>
    </Card>
  );
}
