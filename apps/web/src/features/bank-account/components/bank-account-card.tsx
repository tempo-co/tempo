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
      <Card className='flex items-center justify-between p-4 transition-all hover:border-primary/50 hover:bg-accent'>
        <div className='flex items-center gap-4'>
          <div className='flex h-12 w-12 items-center justify-center rounded-lg bg-muted p-2'>
            <BankIcon bank={bankAccount.bank} className='h-7 w-7' />
          </div>
          <div className='flex flex-col'>
            <p className='font-medium'>{bankAccount.bank}</p>
            <p className='text-sm text-muted-foreground'>{bankAccount.alias || 'Main Account'}</p>
          </div>
        </div>
        <div className='flex flex-col items-end'>
          <CurrencyAmount amount={bankAccount.balance} currency={bankAccount.currency} />
        </div>
      </Card>
    </Link>
  );
}
