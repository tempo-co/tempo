import {useId, useState} from 'react';

import {cn} from '@/utils/cn';

import {BankTransaction} from '../types/bank-transaction';
import {toBankTransactionCategory} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';

type MerchantLogoTileProps = {
  transaction: Pick<BankTransaction, 'merchantLogoUrl' | 'category' | 'cashFlowTreatment'>;
  className?: string;
};

const TILE_CLASS_NAME =
  'h-9 w-9 shrink-0 rounded-full border border-transaction-tile-edge bg-transaction-tile-field text-transaction-tile-ink';

/**
 * The round tile before a transaction's name: the merchant's logo when the API has one, otherwise
 * the category icon. Own transfers and currency exchanges (internal movements) show the activity
 * icon. Both the alpha logo and fallback glyph use the leading tile's Clay palette.
 */
export function MerchantLogoTile({transaction, className}: MerchantLogoTileProps) {
  const filterId = useId();
  const src = transaction.merchantLogoUrl
    ? `${import.meta.env.VITE_API_URL}${transaction.merchantLogoUrl}/mask-v1`
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
      className={cn('relative inline-flex overflow-hidden', TILE_CLASS_NAME, className)}
    >
      {/* Keep ordinary authenticated image loading; cross-origin CSS masks omit API cookies. */}
      <svg aria-hidden='true' className='absolute h-0 w-0 overflow-hidden'>
        <defs>
          <filter id={filterId} colorInterpolationFilters='sRGB'>
            <feFlood floodColor='var(--transaction-tile-ink)' />
            <feComposite in2='SourceAlpha' operator='in' />
          </filter>
        </defs>
      </svg>
      <img
        src={src}
        alt=''
        loading='lazy'
        className='h-full w-full object-cover'
        style={{filter: `url("#${filterId}")`}}
        onError={() => setFailedSrc(src)}
      />
    </span>
  );
}
