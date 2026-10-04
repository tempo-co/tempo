import {Button} from '@/components/ui/button';

import {useUpdateBankTransactionOwnTransfer} from '../api/use-update-bank-transaction-own-transfer';
import {BankTransaction} from '../types/bank-transaction';
import {formatOwnTransferEvidence} from '../utils/formatters';
import {BankTransactionCounterpartLink} from './bank-transaction-counterpart-link';

type BankTransactionOwnTransferProps = {
  transaction: BankTransaction;
};

/** Own-transfer recognition for one transaction: why it matched, the other leg, and the owner's override. */
export function BankTransactionOwnTransfer({transaction}: BankTransactionOwnTransferProps) {
  const {updateBankTransactionOwnTransfer, isPending} = useUpdateBankTransactionOwnTransfer();
  const {ownTransfer, ownTransferOverride: override} = transaction;
  const counterpart = ownTransfer?.counterpart ?? null;

  return (
    // One term/value group keeps the description list valid; visible overflow keeps the focus ring whole.
    <div className='col-span-2 min-w-0' data-testid='bank-transaction-own-transfer'>
      <dt className='text-xs font-medium text-muted-foreground'>Own transfer</dt>
      <dd className='mt-1 space-y-3 overflow-visible! text-sm sm:text-base'>
        {ownTransfer ? (
          <>
            <p>{formatOwnTransferEvidence(ownTransfer.evidence)}</p>
            <div className='min-w-0'>
              <p className='text-xs font-medium text-muted-foreground'>Other side</p>
              {counterpart ? (
                <BankTransactionCounterpartLink
                  counterpart={counterpart}
                  testId='bank-transaction-own-transfer-counterpart'
                />
              ) : (
                <p className='mt-1'>Not in your connected accounts</p>
              )}
            </div>
          </>
        ) : (
          <p>Not recognized</p>
        )}
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            className='min-h-11'
            disabled={isPending}
            onClick={() =>
              void updateBankTransactionOwnTransfer({
                id: transaction.id,
                override: ownTransfer ? 'UNMARKED' : 'MARKED',
                counterpartId: counterpart?.id ?? null,
              })
            }
          >
            {ownTransfer ? 'Not my own transfer' : 'Mark as own transfer'}
          </Button>
          {override ? (
            <Button
              variant='ghost'
              className='min-h-11'
              disabled={isPending}
              onClick={() =>
                void updateBankTransactionOwnTransfer({id: transaction.id, override: null})
              }
            >
              Use automatic recognition
            </Button>
          ) : null}
        </div>
      </dd>
    </div>
  );
}
