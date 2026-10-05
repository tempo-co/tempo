import type {QueryClient} from '@tanstack/react-query';

import {dashboardQueryKeys} from './aggregate-query-keys';
import {bankQueryKeys} from './query-keys';

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
  ]);
}
