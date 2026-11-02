import {useNavigate} from '@tanstack/react-router';
import {
  type CashFlowInterval,
  MERCHANT_RANKING_DEFAULT_LIMIT,
  MERCHANT_SEARCH_MAX_LENGTH,
  type MerchantGroupListItem,
} from '@tempo/contracts';
import {format} from 'date-fns';
import {Search} from 'lucide-react';
import {useEffect, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {ChartCardError, ChartCardHeader} from '@/features/dashboard/components/chart-card';
import {parseCalendarDate} from '@/features/dashboard/utils/drill-links';
import {formatMoney, toCents} from '@/features/dashboard/utils/money';
import {useLocalDate} from '@/hooks/use-local-date';

import {useGetMerchantRanking} from '../api/use-get-merchant-ranking';
import {useGetMerchants} from '../api/use-get-merchants';
import {countLabel, formatUsualComparison} from '../utils/merchant-format';
import {MerchantRow} from './merchant-row';

type MerchantsOverviewProps = {
  search: string;
  interval: CashFlowInterval;
  /** Any day in the ranked period; today when absent. */
  period: string | undefined;
};

/** Where the money went this week, month or year by merchant, and every merchant, searchable. */
export function MerchantsOverview({search, interval, period}: MerchantsOverviewProps) {
  const navigate = useNavigate({from: '/merchants/'});
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return;
    const timeoutId = window.setTimeout(() => {
      void navigate({replace: true, search: (prev) => ({...prev, q: next || undefined})});
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [navigate, search, searchInput]);

  return (
    <div className='grid grid-cols-1 gap-6'>
      <div className='grid gap-4'>
        <h1 className='text-page-title'>Merchants</h1>
        <div className='relative min-w-0 md:max-w-sm'>
          <Search className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            type='search'
            value={searchInput}
            maxLength={MERCHANT_SEARCH_MAX_LENGTH}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder='Search merchants and people'
            aria-label='Search merchants and people'
            className='h-12 pl-9 text-base sm:h-9 sm:text-sm'
          />
        </div>
      </div>
      {search ? (
        <AllMerchants search={search} />
      ) : (
        <>
          <Ranking
            interval={interval}
            period={period}
            onIntervalChange={(next) =>
              void navigate({
                replace: true,
                search: (prev) => ({...prev, interval: next, period: undefined}),
              })
            }
          />
          <AllMerchants search='' />
        </>
      )}
    </div>
  );
}

function Ranking({
  interval,
  period,
  onIntervalChange,
}: {
  interval: CashFlowInterval;
  period: string | undefined;
  onIntervalChange: (interval: CashFlowInterval) => void;
}) {
  const asOf = useLocalDate();
  const {ranking, isPending, isError, refetch} = useGetMerchantRanking(
    interval,
    period && period <= asOf ? period : asOf,
    asOf,
    MERCHANT_RANKING_DEFAULT_LIMIT,
  );
  const loaded = ranking?.interval === interval ? ranking : undefined;
  const running = loaded ? loaded.through < loaded.end : true;

  return (
    <Card className='grid grid-cols-1 gap-4 p-5 sm:p-6' role='region' aria-label='Top merchants'>
      <ChartCardHeader
        title={loaded ? rankingTitle(loaded.start, loaded.end, interval, running) : 'Top merchants'}
        interval={interval}
        onIntervalChange={onIntervalChange}
        toggleLabel='Rank merchants by'
      >
        {loaded && loaded.baselinePeriods.length > 0 && (
          <p className='col-span-2 text-xs text-muted-foreground'>
            {running
              ? `Compared with the last ${loaded.baselinePeriods.length} ${interval}s by this point.`
              : `Compared with the ${loaded.baselinePeriods.length} ${interval}s before.`}
          </p>
        )}
      </ChartCardHeader>
      {isError && !loaded ? (
        <ChartCardError message='Could not load merchants.' onRetry={refetch} />
      ) : isPending || !loaded ? (
        <Skeleton className='h-72' role='img' aria-label='Loading top merchants' />
      ) : loaded.merchants.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No spending this {interval}.</p>
      ) : (
        <ol className='-mx-3 -mb-3 divide-y divide-border/60'>
          {loaded.merchants.map((merchant) => {
            const comparison = formatUsualComparison(merchant, loaded.baseCurrency);
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
                  amount={formatMoney(merchant.spent, loaded.baseCurrency)}
                />
              </li>
            );
          })}
        </ol>
      )}
      {loaded && loaded.total > loaded.merchants.length && (
        <p className='text-xs text-muted-foreground'>
          Top {loaded.merchants.length} of {loaded.total.toLocaleString()} merchants.
        </p>
      )}
    </Card>
  );
}

function rankingTitle(start: string, end: string, interval: CashFlowInterval, running: boolean) {
  const first = parseCalendarDate(start);
  if (interval === 'year') return running ? 'This year' : format(first, 'yyyy');
  if (interval === 'month') return running ? 'This month' : format(first, 'MMMM yyyy');
  return running
    ? 'This week'
    : `Week of ${format(first, 'd MMM')} – ${format(parseCalendarDate(end), 'd MMM')}`;
}

function AllMerchants({search}: {search: string}) {
  const {data, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage} =
    useGetMerchants(search);
  const merchants = data?.pages.flatMap((page) => page.merchants) ?? [];
  const last = data?.pages[data.pages.length - 1];
  const currency = last?.baseCurrency ?? null;

  return (
    <Card
      className='grid grid-cols-1 gap-4 p-5 sm:p-6'
      role='region'
      aria-label={search ? 'Search results' : 'All merchants'}
    >
      <header className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
        <h2 className='text-card-title'>{search ? 'Results' : 'All merchants'}</h2>
        {last && (
          <p className='text-xs text-muted-foreground'>
            {countLabel(last.total, search ? 'match' : 'merchant', search ? 'matches' : undefined)}
            {!search && ', most spent first'}
          </p>
        )}
      </header>
      {isPending ? (
        <Skeleton className='h-72' role='img' aria-label='Loading merchants' />
      ) : isError || !last ? (
        <div className='grid justify-items-start gap-3'>
          <p className='text-sm'>Could not load merchants.</p>
          <Button variant='outline' onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : merchants.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {search ? 'No merchant or person matches that name.' : 'No merchants yet.'}
        </p>
      ) : (
        <>
          <ul className='-mx-3 divide-y divide-border/60'>
            {merchants.map((merchant) => (
              <li key={merchant.id}>
                <MerchantRow
                  merchant={merchant}
                  detail={merchantDetail(merchant)}
                  {...listAmount(merchant, currency)}
                />
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <Button
              variant='ghost'
              className='w-full text-muted-foreground max-sm:h-11'
              disabled={isFetchingNextPage}
              aria-busy={isFetchingNextPage || undefined}
              onClick={() => void fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function merchantDetail(merchant: MerchantGroupListItem) {
  const count = countLabel(merchant.count, 'transaction');
  return merchant.lastDate
    ? `${count} · last ${formatBankTransactionCompactDate(merchant.lastDate)}`
    : count;
}

/** Spent, or for a group that only paid the owner (an employer), what was received. */
function listAmount(merchant: MerchantGroupListItem, currency: string | null) {
  if (toCents(merchant.spent) === 0 && toCents(merchant.received) > 0)
    return {
      amount: `+${formatMoney(merchant.received, currency)}`,
      amountClassName: 'text-success',
    };
  return {amount: formatMoney(merchant.spent, currency)};
}
