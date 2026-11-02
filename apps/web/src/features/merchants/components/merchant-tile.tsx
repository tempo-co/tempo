import type {MerchantGroupListItem} from '@tempo/contracts';

import {MerchantLogoTile} from '@/features/banking/components/merchant-logo-tile';

/** A merchant group's round tile: its brand's logo, or the generic merchant icon. */
export function MerchantTile({
  merchant,
  className,
}: {
  merchant: Pick<MerchantGroupListItem, 'logoUrl'>;
  className?: string;
}) {
  return (
    <MerchantLogoTile
      transaction={{
        merchantLogoUrl: merchant.logoUrl,
        category: null,
        cashFlowTreatment: 'EXPENSE',
      }}
      className={className}
    />
  );
}
