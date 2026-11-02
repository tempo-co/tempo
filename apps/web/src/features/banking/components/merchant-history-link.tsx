import {Link} from '@tanstack/react-router';
import type {BankTransaction} from '@tempo/contracts';
import {ChevronRight} from 'lucide-react';

/** Opens the merchant page of the transaction's merchant or person; nothing for rows without one. */
export function MerchantHistoryLink({
  transaction,
}: {
  transaction: Pick<BankTransaction, 'merchantGroupId'>;
}) {
  // Saved responses from before merchant groups existed have no id at all.
  if (!transaction.merchantGroupId) return null;
  return (
    <Link
      to='/merchants/$merchantId'
      params={{merchantId: transaction.merchantGroupId}}
      className='-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-8'
    >
      Payment history
      <ChevronRight aria-hidden className='size-4' />
    </Link>
  );
}
