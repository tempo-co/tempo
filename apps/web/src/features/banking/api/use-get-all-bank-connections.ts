import {useQuery} from '@tanstack/react-query';

import {BankConnection} from '@/features/banking/types/bank-connection';
import {isSyncInProgress} from '@/features/banking/utils/bank-sync-status';
import {api} from '@/utils/api';

import {invalidateBankDerivedData} from './invalidate-bank-derived-data';
import {bankQueryKeys} from './query-keys';

const AUTOMATIC_SYNC_POLL_INTERVAL_MS = 5_000;

export const useGetAllBankConnections = () => {
  const {
    data: bankConnections,
    isPending,
    isError,
    error,
    fetchStatus,
    refetch,
  } = useQuery<BankConnection[]>({
    queryKey: bankQueryKeys.connections,
    queryFn: async ({client}) => {
      const connections = await api.get<BankConnection[]>('/bank-connections');
      const previous = client.getQueryData<BankConnection[]>(bankQueryKeys.connections);
      const syncAdvanced = connections.some((connection) => {
        const before = previous?.find(({id}) => id === connection.id);
        if (!before) return false;
        return (
          (isSyncInProgress(before) && before.syncStatus !== connection.syncStatus) ||
          (connection.lastSyncedAt !== null &&
            (before.lastSyncedAt === null ||
              Date.parse(connection.lastSyncedAt) > Date.parse(before.lastSyncedAt)))
        );
      });
      // Sync completion only covers ingestion; the API exposes no derived-work revision.
      if (syncAdvanced) await invalidateBankDerivedData(client);
      return connections;
    },
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.some(isSyncInProgress) ? AUTOMATIC_SYNC_POLL_INTERVAL_MS : false,
  });

  return {bankConnections, isPending, isError, error, fetchStatus, refetch};
};
