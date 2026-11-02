import {Link} from '@tanstack/react-router';
import type {MerchantGroupListItem} from '@tempo/contracts';

import {cn} from '@/utils/cn';

import {MerchantTile} from './merchant-tile';

/** One merchant group in a list: tile, name over a detail line, amount. Links to its page. */
export function MerchantRow({
  merchant,
  detail,
  amount,
  amountClassName,
}: {
  merchant: Pick<MerchantGroupListItem, 'id' | 'name' | 'logoUrl'>;
  detail: React.ReactNode;
  amount: string;
  amountClassName?: string;
}) {
  return (
    <Link
      to='/merchants/$merchantId'
      params={{merchantId: merchant.id}}
      className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-sm hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
    >
      <MerchantTile merchant={merchant} />
      <span className='min-w-0'>
        {/* Names wrap to two lines and details wrap fully: the comparison is what the row is for. */}
        <span className='line-clamp-2 wrap-anywhere'>{merchant.name}</span>
        <span className='block text-xs text-muted-foreground'>{detail}</span>
      </span>
      <span className={cn('numeric whitespace-nowrap', amountClassName)}>{amount}</span>
    </Link>
  );
}
