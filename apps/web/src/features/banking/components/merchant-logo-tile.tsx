import {useState} from 'react';

import {cn} from '@/utils/cn';

import {BankTransaction} from '../types/bank-transaction';
import {toBankTransactionCategory} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';

type MerchantLogoTileProps = {
  transaction: Pick<BankTransaction, 'merchantLogoUrl' | 'category' | 'cashFlowTreatment'>;
  className?: string;
};

const TILE_CLASS_NAME = 'h-9 w-9 shrink-0 rounded-full';

/**
 * The round tile before a transaction's name: the merchant's logo when the API has one, otherwise
 * the category icon. Own transfers and currency exchanges (internal movements) show the neutral
 * activity icon.
 */
export function MerchantLogoTile({transaction, className}: MerchantLogoTileProps) {
  const src = transaction.merchantLogoUrl
    ? `${import.meta.env.VITE_API_URL}${transaction.merchantLogoUrl}`
    : null;
  // A logo that fails to load falls back to the category icon until the URL changes.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || src === failedSrc) {
    const {category} = transaction;
    return (
      <BankTransactionCategoryIcon
        category={toBankTransactionCategory(category)}
        activity={transaction.cashFlowTreatment === 'INTERNAL'}
        data-testid='merchant-logo-tile'
        className={cn(TILE_CLASS_NAME, className)}
        iconClassName='h-4 w-4'
      />
    );
  }

  return (
    <span
      aria-hidden='true'
      data-testid='merchant-logo-tile'
      className={cn(
        'inline-flex overflow-hidden border border-border bg-white',
        TILE_CLASS_NAME,
        className,
      )}
    >
      <img
        src={src}
        alt=''
        loading='lazy'
        className='h-full w-full object-cover'
        onError={() => setFailedSrc(src)}
      />
    </span>
  );
}
