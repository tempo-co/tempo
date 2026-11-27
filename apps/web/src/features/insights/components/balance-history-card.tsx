import {History} from 'lucide-react';

import {LoadErrorState, StateMessage} from '@/components/shared/state-message';
import {Card} from '@/components/ui/card';
import {BalanceChart, BalanceChartSkeleton} from '@/features/dashboard/components/balance-chart';
import type {BalancePoint} from '@/features/dashboard/utils/overview';

/**
 * The total balance across shown accounts over the period, at each month end or, over This month, each day end; a
 * point opens its month. A period without any balance says so rather than drawing zero.
 */
export function BalanceHistoryCard({
  points,
  unit,
  currency,
  error,
  onRetry,
  onPick,
}: {
  /** Null while loading. */
  points: BalancePoint[] | null;
  unit: 'month' | 'day';
  currency: string | null;
  /** Set when the points failed to load. */
  error?: unknown;
  onRetry: () => unknown;
  onPick: (month: string) => void;
}) {
  return (
    <Card
      role='region'
      aria-label='Balance over time'
      aria-busy={(points === null && !error) || undefined}
      className='grid min-w-0 gap-4 p-4'
    >
      <h2 className='text-card-title'>Balance over time</h2>
      {points === null ? (
        <BalanceChartSkeleton>
          {error ? (
            <LoadErrorState
              size='section'
              title="Couldn't load the balance"
              error={error}
              onRetry={onRetry}
            />
          ) : undefined}
        </BalanceChartSkeleton>
      ) : points.length === 0 ? (
        <BalanceChartSkeleton>
          <StateMessage
            size='section'
            icon={History}
            title='No total balance for this period'
            description='Balances add up only for shown accounts, in your reporting currency.'
          />
        </BalanceChartSkeleton>
      ) : (
        <div className='flex'>
          <BalanceChart points={points} unit={unit} currency={currency} onPick={onPick} />
        </div>
      )}
    </Card>
  );
}
