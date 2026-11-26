import {MERCHANT_SEARCH_MAX_LENGTH, type MerchantGroupListItem} from '@tempo/contracts';
import {useEffect, useState} from 'react';

import {LoadMore} from '@/components/shared/load-more';
import {SearchInput} from '@/components/shared/search-input';
import {LoadErrorState} from '@/components/shared/state-message';
import {Skeleton} from '@/components/ui/skeleton';
import {formatBankTransactionCompactDate} from '@/features/banking/utils/formatters';
import {formatMoney, toCents} from '@/features/dashboard/utils/money';
import {useFiguresCurrencyAccepted} from '@/features/reporting-currency/api/use-reporting-currency';

import {useGetMerchants} from '../api/use-get-merchants';
import {countLabel} from '../utils/merchant-format';
import {MerchantRow} from './merchant-row';

/** Every merchant and person with transactions between two local dates, most spent first, searchable. */
export function MerchantsOverview({
  range,
  onSelect,
  searchInput,
  onSearchInputChange,
}: {
  range: {from: string; to: string};
  onSelect: (merchantId: string) => void;
  /** Kept by the caller, so opening a merchant and coming back keeps the search. */
  searchInput: string;
  onSearchInputChange: (value: string) => void;
}) {
  const [search, setSearch] = useState(searchInput.trim());

  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return;
    const timeoutId = window.setTimeout(() => setSearch(next), 300);
    return () => window.clearTimeout(timeoutId);
  }, [search, searchInput]);

  return (
    <div className='grid grid-cols-1 gap-4'>
      <SearchInput
        value={searchInput}
        onValueChange={onSearchInputChange}
        onClear={() => setSearch('')}
        maxLength={MERCHANT_SEARCH_MAX_LENGTH}
        placeholder='Search merchants and people'
        aria-label='Search merchants and people'
        className='h-12 text-base sm:h-8 sm:text-body'
      />
      <AllMerchants search={search} range={range} onSelect={onSelect} />
    </div>
  );
}

function AllMerchants({
  search,
  range,
  onSelect,
}: {
  search: string;
  range: {from: string; to: string};
  onSelect: (merchantId: string) => void;
}) {
  const query = useGetMerchants(search, range);
  const {data, isPending, isPlaceholderData, error, refetch} = query;
  const merchants = data?.pages.flatMap((page) => page.merchants) ?? [];
  const last = data?.pages[data.pages.length - 1];
  const currency = last?.baseCurrency ?? null;
  // Pages read on either side of a currency change, or outside the reporting currency, wait for the list to reload.
  const accepted = useFiguresCurrencyAccepted();
  const consistent =
    !!data?.pages.every((page) => page.baseCurrency === currency) && accepted(currency);

  return (
    <section
      className='grid grid-cols-1 gap-4'
      aria-label={search ? 'Search results' : 'All merchants'}
    >
      {last && !isPlaceholderData && (
        <p className='text-body-small text-muted-foreground'>
          {countLabel(last.total, search ? 'match' : 'merchant', search ? 'matches' : undefined)}
          {!search && ', most spent first'}
        </p>
      )}
      {/* Another search's or period's list never stands under this one's count. */}
      {isPending || isPlaceholderData || (last && !consistent) ? (
        <Skeleton className='h-72' role='img' aria-label='Loading merchants' />
      ) : !last ? (
        <LoadErrorState
          size='section'
          title="Couldn't load merchants"
          error={error}
          onRetry={refetch}
        />
      ) : merchants.length === 0 ? (
        <p className='text-body-small text-muted-foreground'>
          {search ? 'No merchant or person matches that name.' : 'No merchants in this period.'}
        </p>
      ) : (
        <>
          <ul className='-mx-3 divide-y divide-border/60'>
            {merchants.map((merchant) => (
              <li key={merchant.id}>
                <MerchantRow
                  merchant={merchant}
                  onSelect={onSelect}
                  detail={merchantDetail(merchant)}
                  {...listAmount(merchant, currency)}
                />
              </li>
            ))}
          </ul>
          <LoadMore query={query} />
        </>
      )}
    </section>
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
