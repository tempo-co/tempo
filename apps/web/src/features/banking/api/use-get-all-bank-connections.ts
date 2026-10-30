import {queryOptions, useQuery} from '@tanstack/react-query';
import {BankConnection} from '@tempo/contracts';

import {isSyncInProgress} from '@/features/banking/utils/bank-sync-status';
import {api} from '@/utils/api';

import {invalidateBankDerivedData} from './invalidate-bank-derived-data';
import {bankQueryKeys} from './query-keys';

const AUTOMATIC_SYNC_POLL_INTERVAL_MS = 5_000;

/** Whether a saved connection finished a sync between two reads of the connection list. */
export function hasSyncAdvanced(
  previous: BankConnection[] | undefined,
  connections: BankConnection[] | undefined,
) {
  return !!connections?.some((connection) => {
    const before = previous?.find(({id}) => id === connection.id);
    if (!before) return false;
    return (
      (isSyncInProgress(before) && before.syncStatus !== connection.syncStatus) ||
      (connection.lastSyncedAt !== null &&
        (before.lastSyncedAt === null ||
          Date.parse(connection.lastSyncedAt) > Date.parse(before.lastSyncedAt)))
    );
  });
}

export const bankConnectionsQueryOptions = queryOptions({
  queryKey: bankQueryKeys.connections,
  queryFn: async ({client}) => {
    const connections = await api.get<BankConnection[]>('/bank-connections');
    const previous = client.getQueryData<BankConnection[]>(bankQueryKeys.connections);
    // Sync completion only covers ingestion; the API exposes no derived-work revision.
    if (hasSyncAdvanced(previous, connections)) await invalidateBankDerivedData(client);
    return connections;
  },
  retry: false,
});

export const useGetAllBankConnections = () => {
  const {
    data: bankConnections,
    isPending,
    isError,
    error,
    fetchStatus,
    refetch,
  } = useQuery({
    ...bankConnectionsQueryOptions,
    refetchInterval: (query) =>
      query.state.data?.some(isSyncInProgress) ? AUTOMATIC_SYNC_POLL_INTERVAL_MS : false,
  });

  return {bankConnections, isPending, isError, error, fetchStatus, refetch};
};
