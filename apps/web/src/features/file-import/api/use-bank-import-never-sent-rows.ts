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

/** The import's rows its bank never sent, read once while the list is open: added rows stay on screen as added. */
export function useBankImportNeverSentRows(importId: string, enabled: boolean) {
  return useQuery({
    queryKey: bankImportQueryKeys.neverSentRows(importId),
    queryFn: () => api.get<BankImportNeverSentRow[]>(`/bank-imports/${importId}/never-sent-rows`),
    enabled,
    staleTime: Infinity,
    gcTime: 0,
  });
}

/**
 * Adds never-sent rows to the import. A group larger than one request allows goes in several, one after another;
 * each answers with the import's summary, the last one the newest.
 */
export function useAddNeverSentRows() {
  const queryClient = useQueryClient();
  const {mutateAsync} = useMutation({
    mutationFn: async ({importId, rowIds}: {importId: string; rowIds: string[]}) => {
      let summary: BankImportSummary | null = null;
      for (let start = 0; start < rowIds.length; start += BANK_IMPORT_MAX_ROWS_PER_ADD) {
        summary = await api.post<BankImportSummary>(
          `/bank-imports/${importId}/never-sent-rows/add`,
          {
            rowIds: rowIds.slice(start, start + BANK_IMPORT_MAX_ROWS_PER_ADD),
          } satisfies AddBankImportNeverSentRowsRequest,
        );
        storeImportSummary(queryClient, summary);
      }
      return summary!;
    },
    onSettled: () => void invalidateAfterImportChange(queryClient),
  });
  return {addNeverSentRows: mutateAsync};
}
