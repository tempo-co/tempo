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
 * Reads the list again after an add was refused because another tab added a row or undid the import. The rows the
 * API no longer lists leave, except those in `added` (added from this summary), which stay shown as added.
 */
export function useRefreshNeverSentRows(importId: string) {
  const queryClient = useQueryClient();
  return (added: ReadonlySet<string>) =>
    queryClient.fetchQuery({
      queryKey: bankImportQueryKeys.neverSentRows(importId),
      staleTime: 0,
      queryFn: async () => {
        const fresh = await readNeverSentRows(importId);
        const previous =
          queryClient.getQueryData<BankImportNeverSentRow[]>(
            bankImportQueryKeys.neverSentRows(importId),
          ) ?? [];
        const listed = new Set(fresh.map(({id}) => id));
        const known = new Set(previous.map(({id}) => id));
        return [
          ...previous.filter(({id}) => listed.has(id) || added.has(id)),
          ...fresh.filter(({id}) => !known.has(id)),
        ];
      },
    });
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
