import {Link, type LinkProps} from '@tanstack/react-router';
import type {BankTransaction} from '@tempo/contracts';

import {CurrencyAmount} from '@/components/shared/currency-amount';

import {
  formatBankTransactionCompactDate,
  resolveBankTransactionDisplayTitle,
} from '../utils/formatters';
import {MerchantLogoTile} from './merchant-logo-tile';

/** One transaction in a short list: tile, title over date, amount. Every such list uses this row. */
export function TransactionListRow({
  transaction,
  link,
}: {
  transaction: BankTransaction;
  link: Pick<LinkProps, 'to' | 'search'>;
}) {
  return (
    <Link
      {...link}
      className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
    >
      <MerchantLogoTile transaction={transaction} />
      <div className='min-w-0'>
        <p className='truncate text-sm'>{resolveBankTransactionDisplayTitle(transaction)}</p>
        <p className='truncate text-xs text-muted-foreground'>
          {formatBankTransactionCompactDate(transaction.bookingDate ?? transaction.transactionDate)}
        </p>
      </div>
      <span className='text-sm'>
        <CurrencyAmount amount={Number(transaction.amount)} currency={transaction.currency} />
      </span>
    </Link>
  );
}
