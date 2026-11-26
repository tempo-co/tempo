import type {RecurringSeries} from '@tempo/contracts';

import {MerchantLogoTile} from './merchant-logo-tile';

/** A series' tile is its latest payment's: the same merchant logo or category icon as on its transactions. */
export function SeriesTile({
  series,
  className,
}: {
  series: Pick<RecurringSeries, 'merchantLogoUrl' | 'category' | 'direction'>;
  className?: string;
}) {
  return (
    <MerchantLogoTile
      transaction={{
        merchantLogoUrl: series.merchantLogoUrl,
        category: series.category,
        cashFlowTreatment: series.direction,
      }}
      className={className}
    />
  );
}
