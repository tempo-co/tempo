import {useQuery} from '@tanstack/react-query';

import {BankConnection} from '@/features/banking/types/bank-connection';
import {api} from '@/utils/api';

import {bankQueryKeys} from './query-keys';

const AUTOMATIC_SYNC_POLL_INTERVAL_MS = 5_000;

export const useGetAllBankConnections = () => {
  const {
    data: bankConnections,
    isPending,
    isError,
    refetch,
  } = useQuery<BankConnection[]>({
    queryKey: bankQueryKeys.connections,
    queryFn: async () => {
      return await api.get<BankConnection[]>('/bank-connections');
    },
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.some(
        (connection) => connection.syncStatus === 'QUEUED' || connection.syncStatus === 'RUNNING',
      )
        ? AUTOMATIC_SYNC_POLL_INTERVAL_MS
        : false,
  });

  return {bankConnections, isPending, isError, refetch};
};
