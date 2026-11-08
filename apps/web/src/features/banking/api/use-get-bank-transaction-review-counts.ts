import {useQuery} from '@tanstack/react-query';
import type {BankTransactionReviewCounts} from '@tempo/contracts';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {HOME_REFRESH_INTERVAL_MS} from '@/features/dashboard/api/refresh-interval';
import {api} from '@/utils/api';

/** Transactions across all months that still need the owner's attention. */
export const useGetBankTransactionReviewCounts = () => {
  const {data, isPending, isError, refetch} = useQuery<BankTransactionReviewCounts>({
    queryKey: dashboardQueryKeys.reviewCounts,
    queryFn: () => api.get<BankTransactionReviewCounts>('/bank-transactions/review-counts'),
    refetchInterval: HOME_REFRESH_INTERVAL_MS,
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
