import type {MerchantGroupListItem} from '@tempo/contracts';

import {cn} from '@/utils/cn';

import {MerchantTile} from './merchant-tile';

/** One merchant group in a list: tile, name over a detail line, amount. Opens its details. */
export function MerchantRow({
  merchant,
  detail,
  amount,
  amountClassName,
  onSelect,
}: {
  merchant: Pick<MerchantGroupListItem, 'id' | 'name' | 'logoUrl'>;
  detail: React.ReactNode;
  amount: string;
  amountClassName?: string;
  onSelect: (merchantId: string) => void;
}) {
  return (
    <button
      type='button'
      onClick={() => onSelect(merchant.id)}
      className='grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left text-sm hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
    >
      <MerchantTile merchant={merchant} />
      <span className='min-w-0'>
        {/* Names wrap to two lines and details wrap fully: the comparison is what the row is for. */}
        <span className='line-clamp-2 wrap-anywhere'>{merchant.name}</span>
        <span className='block text-xs text-muted-foreground'>{detail}</span>
      </span>
      <span className={cn('numeric whitespace-nowrap', amountClassName)}>{amount}</span>
    </button>
  );
}
