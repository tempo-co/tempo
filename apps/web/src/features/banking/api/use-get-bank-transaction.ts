import {QueryClient, useQuery, useQueryClient} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {BankTransaction, BankTransactionsResponse} from '../types/bank-transaction';
import {bankQueryKeys} from './query-keys';

/** The same transaction from an already-loaded transactions page, if any. */
const findListedBankTransaction = (queryClient: QueryClient, id: BankTransaction['id']) => {
  for (const [, page] of queryClient.getQueriesData<BankTransactionsResponse>({
    queryKey: bankQueryKeys.transactionsRoot,
  })) {
    const transaction = page?.transactions.find((listed) => listed.id === id);
    if (transaction) return transaction;
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
    staleTime: 30_000,
    retry: false,
  });

  return {transaction, isPending, isFetching, isError, error, refetch};
};
