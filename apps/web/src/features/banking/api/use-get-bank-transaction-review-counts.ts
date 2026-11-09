import {useQuery} from '@tanstack/react-query';
import {useLocation} from '@tanstack/react-router';
import type {BankTransactionReviewCounts} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {HOME_REFRESH_INTERVAL_MS} from '@/features/dashboard/api/refresh-interval';
import {api} from '@/utils/api';

/**
 * Elsewhere only the navigation badge and the app icon show the counts. Returning to the tab and any change to bank
 * data still refresh them right away.
 */
const AWAY_REFRESH_INTERVAL_MS = 5 * 60_000;

/** Home and Transactions, where the counts sit next to what they count. */
const isReviewPage = (pathname: string) =>
  pathname === '/' ||
  pathname === '/bank-transactions' ||
  pathname.startsWith('/bank-transactions/');

/** Transactions across all months that still need the owner's attention. */
export const useGetBankTransactionReviewCounts = () => {
  const onReviewPage = useLocation({select: (location) => isReviewPage(location.pathname)});
  const {data, isPending, isError, refetch} = useQuery<BankTransactionReviewCounts>({
    queryKey: dashboardQueryKeys.reviewCounts,
    queryFn: () => api.get<BankTransactionReviewCounts>('/bank-transactions/review-counts'),
    refetchInterval: onReviewPage ? HOME_REFRESH_INTERVAL_MS : AWAY_REFRESH_INTERVAL_MS,
    // The navigation and Home's drill links read it too; one read serves them all until the next refresh.
    staleTime: HOME_REFRESH_INTERVAL_MS,
    refetchOnReconnect: 'always',
  });

  return {reviewCounts: data, isPending, isError, refetch};
};

/**
 * Whether any transaction still waits for a base-currency amount. Totals leave those out, so a drill from a total
 * then lists only rows that have one.
 */
export const useHasMissingBaseAmounts = () =>
  (useGetBankTransactionReviewCounts().reviewCounts?.missingBaseAmount ?? 0) > 0;
