import {useActiveBankAccounts} from '../api/use-active-bank-accounts';
import {BankTransaction} from '../types/bank-transaction';
import {resolveBankTransactionAccountLabel} from '../utils/formatters';

type BankTransactionSourceCellProps = {
  transaction: BankTransaction;
};

export function BankTransactionSourceCell({transaction}: BankTransactionSourceCellProps) {
  const {needsAccountName} = useActiveBankAccounts();

  return (
    <div className='w-full min-w-0'>
      <p className='truncate'>{transaction.bankName}</p>
      <p className='truncate text-xs text-muted-foreground'>
        {transaction.currency}
        {needsAccountName(transaction) && ` · ${resolveBankTransactionAccountLabel(transaction)}`}
      </p>
    </div>
  );
}
