import {Link} from '@tanstack/react-router';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {useGetMerchantRanking} from '@/features/merchants/api/use-get-merchant-ranking';
import {MerchantRow} from '@/features/merchants/components/merchant-row';
import {countLabel, formatUsualComparison} from '@/features/merchants/utils/merchant-format';

import {formatMoney} from '../utils/money';
import {localDate, shiftMonth} from '../utils/month';

const SHOWN = 5;

/** Where the month's money went by merchant, against each one's usual; the full ranking is one tap away. */
export function TopMerchantsCard({
  month,
  isCurrentMonth,
}: {
  month: string;
  isCurrentMonth: boolean;
}) {
  // A stable date after a past month ends ranks the whole month without changing its cache key each day.
  const asOf = isCurrentMonth ? localDate() : `${shiftMonth(month, 1)}-01`;
  const {ranking, isPending, isError, refetch} = useGetMerchantRanking(
    'month',
    `${month}-01`,
    asOf,
    SHOWN,
  );

  if (isPending) return <Skeleton className='h-72' aria-label='Loading top merchants' />;

  return (
    // One shrinkable column: an implicit grid track grows to a truncated name's full width.
    <Card className='grid grid-cols-1 gap-4 p-5 sm:p-6' role='region' aria-label='Top merchants'>
      <header className='-my-2.5 flex flex-wrap items-center justify-between gap-x-2'>
        <h2 className='text-card-title'>Top merchants</h2>
        <Link
          to='/merchants'
          search={{period: `${month}-01`}}
          className='-mr-3 inline-flex min-h-11 items-center px-3 text-xs text-primary underline-offset-4 hover:bg-accent/50 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
          aria-label='See all merchants'
        >
          See all
        </Link>
      </header>
      {isError || !ranking ? (
        <div className='grid justify-items-start gap-3'>
          <p className='text-sm'>Could not load merchants.</p>
          <Button variant='outline' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : ranking.merchants.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No spending this month.</p>
      ) : (
        <>
          {ranking.baselinePeriods.length > 0 && (
            <p className='-mt-2 text-xs text-muted-foreground'>
              {isCurrentMonth
                ? 'Compared with usual by this day of the month.'
                : 'Compared with usual for a full month.'}
            </p>
          )}
          <ul className='-mx-3 -mb-3 divide-y divide-border/60'>
            {ranking.merchants.map((merchant) => {
              const comparison = formatUsualComparison(merchant, ranking.baseCurrency);
              return (
                <li key={merchant.id}>
                  <MerchantRow
                    merchant={merchant}
                    detail={
                      <>
                        {countLabel(merchant.count, 'transaction')}
                        {comparison && <> · {comparison}</>}
                      </>
                    }
                    amount={formatMoney(merchant.spent, ranking.baseCurrency)}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
