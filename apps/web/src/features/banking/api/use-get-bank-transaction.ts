import {QueryClient, useQuery, useQueryClient} from '@tanstack/react-query';
import {BankTransaction} from '@tempo/contracts';

import {api} from '@/utils/api';

import {type CachedTransactionList, listedPages} from './listed-transactions';
import {bankQueryKeys} from './query-keys';

/** The same transaction from an already-loaded transactions page, if any. */
const findListedBankTransaction = (queryClient: QueryClient, id: BankTransaction['id']) => {
  for (const [, list] of queryClient.getQueriesData<CachedTransactionList>({
    queryKey: bankQueryKeys.transactionsRoot,
  })) {
    for (const page of listedPages(list)) {
      const transaction = page.transactions.find((listed) => listed.id === id);
      if (transaction) return transaction;
    }
  }
  return undefined;
};

export const bankTransactionQueryOptions = (id: BankTransaction['id']) => ({
  queryKey: bankQueryKeys.transaction(id),
  queryFn: () => api.get<BankTransaction>(`/bank-transactions/${id}`),
});

export const useGetBankTransaction = (id: BankTransaction['id'], enabled = true) => {
  const queryClient = useQueryClient();
  const {
    data: transaction,
    isPending,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<BankTransaction>({
    ...bankTransactionQueryOptions(id),
    enabled: enabled && Boolean(id),
    // Show the row the list already loaded while the detail request re-validates it.
    placeholderData: () => findListedBankTransaction(queryClient, id),
    // A copy restored from offline storage can predate a change saved just before the reload, so
    // only details fetched since this page loaded count as fresh.
    staleTime: (query) => (query.state.dataUpdatedAt < performance.timeOrigin ? 0 : 30_000),
    retry: false,
  });

  return {transaction, isPending, isFetching, isError, error, refetch};
};
