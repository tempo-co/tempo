import {formatMoney} from '@/features/dashboard/utils/money';
import {cn} from '@/utils/cn';

import type {RecurringSeries} from '../types/recurring-series';
import {formatPriceChange, isPast} from '../utils/recurring-format';
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

/**
 * The one thing worth a second look on a row, in priority order. Calm rows show nothing, or the
 * monthly cost of a non-monthly payment as plain text.
 */
export function SeriesIssue({
  series,
  fallback = null,
}: {
  series: RecurringSeries;
  fallback?: string | null;
}) {
  if (isPast(series)) return fallback ? <Hint>{fallback}</Hint> : null;
  if (series.flags.includes('LATE')) return <Hint className='text-warning'>Not paid yet</Hint>;
  if (series.flags.includes('HIGHER_THAN_USUAL'))
    return (
      <Hint className='text-warning'>
        Last {formatMoney(series.latestAmount, series.currency)} · higher
      </Hint>
    );
  if (series.priceChange)
    return <Hint>{formatPriceChange(series.priceChange, series.currency)}</Hint>;
  if (series.amountRange)
    return (
      <Hint>
        {formatMoney(series.amountRange.low, series.currency)}–
        {formatMoney(series.amountRange.high, series.currency)}
      </Hint>
    );
  return fallback ? <Hint>{fallback}</Hint> : null;
}

function Hint({children, className}: {children: React.ReactNode; className?: string}) {
  return (
    <span
      className={cn('block numeric text-xs whitespace-nowrap text-muted-foreground', className)}
    >
      {children}
    </span>
  );
}
