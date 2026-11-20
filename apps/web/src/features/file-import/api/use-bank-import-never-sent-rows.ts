import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  type AddBankImportNeverSentRowsRequest,
  BANK_IMPORT_MAX_ROWS_PER_ADD,
  type BankImportNeverSentRow,
  type BankImportSummary,
} from '@tempo/contracts';

import {api} from '@/utils/api';

import {
  bankImportQueryKeys,
  invalidateAfterImportChange,
  storeImportSummary,
} from './use-bank-imports';

const readNeverSentRows = (importId: string) =>
  api.get<BankImportNeverSentRow[]>(`/bank-imports/${importId}/never-sent-rows`);

/** The import's rows its bank never sent, read once while the list is open: added rows stay on screen as added. */
export function useBankImportNeverSentRows(importId: string, enabled: boolean) {
  return useQuery({
    queryKey: bankImportQueryKeys.neverSentRows(importId),
    queryFn: () => readNeverSentRows(importId),
    enabled,
    staleTime: Infinity,
    gcTime: 0,
  });
}

/**
 * Reads the list again after an add failed, and answers with the rows listed when it started that it no longer lists:
 * they were added, here (whose answer may not have arrived) or in another tab. Every row stays on screen; rows
 * that newly appeared join the list. A read that fails answers with none and leaves the list as it was. It reads
 * through the query cache, so an expired session signs out as on any other read.
 */
export function useRefreshNeverSentRows(importId: string) {
  const queryClient = useQueryClient();
  return async (): Promise<string[]> => {
    // Only rows listed before the read can have been added by the time it answers; rows the list gained meanwhile
    // are judged by a later read.
    const before = (
      queryClient.getQueryData<BankImportNeverSentRow[]>(
        bankImportQueryKeys.neverSentRows(importId),
      ) ?? []
    ).map(({id}) => id);
    let fresh: BankImportNeverSentRow[];
    try {
      fresh = await queryClient.fetchQuery({
        queryKey: [...bankImportQueryKeys.neverSentRows(importId), 'reread'],
        queryFn: () => readNeverSentRows(importId),
        staleTime: 0,
        gcTime: 0,
        retry: false,
      });
    } catch {
      return [];
    }
    const listed = new Set(fresh.map(({id}) => id));
    queryClient.setQueryData<BankImportNeverSentRow[]>(
      bankImportQueryKeys.neverSentRows(importId),
      (previous = []) => {
        const known = new Set(previous.map(({id}) => id));
        return [...previous, ...fresh.filter(({id}) => !known.has(id))];
      },
    );
    return before.filter((id) => !listed.has(id));
  };
}

/**
 * Adds never-sent rows to the import. A group larger than one request allows goes in several, one after another;
 * each answers with the import's summary, the last one the newest. `onAdded` hears each request's rows once they
 * are added, so a group that fails partway still shows the rows that made it.
 */
export function useAddNeverSentRows() {
  const queryClient = useQueryClient();
  const {mutateAsync} = useMutation({
    mutationFn: async ({
      importId,
      rowIds,
      onAdded,
    }: {
      importId: string;
      rowIds: string[];
      onAdded: (rowIds: string[]) => void;
    }) => {
      let summary: BankImportSummary | null = null;
      for (let start = 0; start < rowIds.length; start += BANK_IMPORT_MAX_ROWS_PER_ADD) {
        const chunk = rowIds.slice(start, start + BANK_IMPORT_MAX_ROWS_PER_ADD);
        summary = await api.post<BankImportSummary>(
          `/bank-imports/${importId}/never-sent-rows/add`,
          {rowIds: chunk} satisfies AddBankImportNeverSentRowsRequest,
        );
        storeImportSummary(queryClient, summary);
        onAdded(chunk);
      }
      return summary!;
    },
    onSettled: () => void invalidateAfterImportChange(queryClient),
  });
  return {addNeverSentRows: mutateAsync};
}
