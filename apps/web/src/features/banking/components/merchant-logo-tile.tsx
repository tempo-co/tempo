import {BankTransaction} from '@tempo/contracts';
import {useId, useState} from 'react';

import {cn} from '@/utils/cn';

import {toBankTransactionCategory} from '../utils/formatters';
import {BankTransactionCategoryIcon} from './bank-transaction-category-icon';

type MerchantLogoTileProps = {
  transaction: Pick<BankTransaction, 'merchantLogoUrl' | 'category' | 'cashFlowTreatment'>;
  className?: string;
  /** The fallback icon's size, for tiles smaller than the default. */
  iconClassName?: string;
};

const TILE_SHAPE = 'h-9 w-9 shrink-0 rounded-full';
const NEUTRAL_TILE =
  'border border-transaction-tile-border bg-transaction-tile text-transaction-tile-foreground';

/**
 * The round tile before a transaction's name: the merchant's logo when the API has one, in the
 * leading tile's colours; otherwise the category icon, tinted with the category's colour. Own
 * transfers and currency exchanges (internal movements) and uncategorised rows show a neutral icon.
 */
export function MerchantLogoTile({
  transaction,
  className,
  iconClassName = 'h-4 w-4',
}: MerchantLogoTileProps) {
  const filterId = useId();
  const src = transaction.merchantLogoUrl
    ? `${import.meta.env.VITE_API_URL}${transaction.merchantLogoUrl}/mask-v3`
    : null;
  // A logo that fails to load falls back to the category icon until the URL changes.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || src === failedSrc) {
    const category = toBankTransactionCategory(transaction.category);
    const activity = transaction.cashFlowTreatment === 'INTERNAL';
    return (
      <BankTransactionCategoryIcon
        category={category}
        activity={activity}
        data-testid='merchant-logo-tile'
        className={cn(TILE_SHAPE, (activity || !category) && NEUTRAL_TILE, className)}
        iconClassName={iconClassName}
      />
    );
  }

  return (
    <span
      aria-hidden='true'
      data-testid='merchant-logo-tile'
      className={cn('relative inline-flex overflow-hidden', TILE_SHAPE, NEUTRAL_TILE, className)}
    >
      {/* Keep ordinary authenticated image loading; cross-origin CSS masks omit API cookies. */}
      <svg aria-hidden='true' className='absolute h-0 w-0 overflow-hidden'>
        <defs>
          <filter id={filterId} colorInterpolationFilters='sRGB'>
            <feFlood floodColor='var(--color-transaction-tile-foreground)' />
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
