import {Link} from '@tanstack/react-router';

import {BankIcon} from '@/components/shared/bank-icon';
import {CurrencyAmount} from '@/components/shared/currency-amount';
import {Card} from '@/components/ui/card';
import {BankAccount} from '@/types/bank-account';

type AccountCardProps = {
  bankAccount: BankAccount;
};

export function BankAccountCard({bankAccount}: AccountCardProps) {
  return (
    <Link to='/bank-accounts/$bankAccountId' params={{bankAccountId: bankAccount.id}}>
      <Card className='flex items-center justify-between p-4 hover:bg-accent'>
        <div className='flex items-center'>
          <div className='rounded-md bg-muted p-2'>
            <BankIcon bank={bankAccount.bank} className='w-7' />
          </div>
          <div className='ml-4 flex flex-col'>
            <p>
              {bankAccount.bank}{' '}
              {bankAccount.alias && (
                <span className='text-muted-foreground'>({bankAccount.alias})</span>
              )}
            </p>
            <p className='font-mono'>
              <CurrencyAmount amount={bankAccount.balance} currency={bankAccount.currency} />
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
