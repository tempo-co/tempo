import {BankStatement} from '@/types/bank-statement';

import {formatPeriod} from '../../utils/format-period';

type DeleteBankStatementDialogDescriptionProps = {
  transactionsCount: number;
  period: BankStatement['period'];
};

export function DeleteBankStatementDialogDescription({
  transactionsCount,
  period,
}: DeleteBankStatementDialogDescriptionProps) {
  return (
    <>
      Are you sure you want to delete this bank statement
      {transactionsCount > 0 && (
        <>
          <span>, including all of its</span>{' '}
          <span className='text-foreground'>
            {transactionsCount} {transactionsCount === 1 ? 'transaction' : 'transactions'}
          </span>
        </>
      )}{' '}
      from <span className='text-foreground'>{formatPeriod(period)}</span>?
      <p className='mt-2'>This action cannot be undone.</p>
    </>
  );
}
