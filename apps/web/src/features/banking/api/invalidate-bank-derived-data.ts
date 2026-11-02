import type {QueryClient} from '@tanstack/react-query';

import {merchantQueryKeys} from '@/features/merchants/api/merchant-query-keys';

import {dashboardQueryKeys} from './aggregate-query-keys';
import {bankQueryKeys} from './query-keys';
import {recurringQueryKeys} from './recurring-query-keys';

/**
 * Marks every cache derived from bank transactions stale, including inactive months and filtered
 * lists. `exceptTransactionId` skips a transaction detail the caller has just written.
 */
export function invalidateBankDerivedData(
  queryClient: QueryClient,
  {exceptTransactionId}: {exceptTransactionId?: string} = {},
) {
  return Promise.all([
    queryClient.invalidateQueries({queryKey: dashboardQueryKeys.root}),
    queryClient.invalidateQueries({queryKey: bankQueryKeys.transactionsRoot}),
    queryClient.invalidateQueries({
      queryKey: bankQueryKeys.transactionRoot,
      predicate: ({queryKey}) => queryKey[1] !== exceptTransactionId,
    }),
    queryClient.invalidateQueries({queryKey: bankQueryKeys.connectionTransactionsRoot}),
    // Own-transfer and category changes move payments in or out of recurring series.
    queryClient.invalidateQueries({queryKey: recurringQueryKeys.root}),
    // Refund categories and own transfers change merchant totals too.
    queryClient.invalidateQueries({queryKey: merchantQueryKeys.root}),
  ]);
}
