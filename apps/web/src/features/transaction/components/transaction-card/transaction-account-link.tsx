import {Link} from '@tanstack/react-router';

import {BankIcon} from '@/components/shared/bank-icon';
import {Transaction} from '@/types/transaction';

type TransactionBankAccountLinkProps = {
  transaction: Transaction;
};

export function TransactionBankAccountLink({transaction}: TransactionBankAccountLinkProps) {
  return (
    <Link
      className='flex items-center underline-offset-4 hover:underline'
      to={'/bank-accounts/$bankAccountId'}
      params={{bankAccountId: transaction.bankAccount.id}}
    >
      <div className='mr-1 rounded-md bg-muted p-1'>
        <BankIcon bank={transaction.bankAccount.bank} className='h-3 w-3' />
      </div>
      {transaction.bankAccount.bank}
      {transaction.bankAccount.alias && (
        <span className='text-muted-foreground'>({transaction.bankAccount.alias})</span>
      )}
    </Link>
  );
}
