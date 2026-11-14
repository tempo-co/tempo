import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import type {
  BankImportDoubtfulRow,
  BankImportSummary,
  ResolveBankImportDoubtfulRowRequest,
} from '@tempo/contracts';

import {api} from '@/utils/api';

import {
  bankImportQueryKeys,
  invalidateAfterImportChange,
  storeImportSummary,
} from './use-bank-imports';

/** An import's open doubtful rows, read once per review: answered rows stay on screen as answered. */
export function useBankImportDoubtfulRows(importId: string) {
  return useQuery({
    queryKey: bankImportQueryKeys.doubtfulRows(importId),
    queryFn: () => api.get<BankImportDoubtfulRow[]>(`/bank-imports/${importId}/doubtful-rows`),
    staleTime: Infinity,
    gcTime: 0,
  });
}

/** Decides one doubtful row, once: the API has no way to change the answer. Answers with the import's summary. */
export function useResolveDoubtfulRow() {
  const queryClient = useQueryClient();
  const {mutateAsync} = useMutation({
    mutationFn: ({
      importId,
      rowId,
      ...request
    }: ResolveBankImportDoubtfulRowRequest & {importId: string; rowId: string}) =>
      api.post<BankImportSummary>(
        `/bank-imports/${importId}/doubtful-rows/${rowId}/resolve`,
        request satisfies ResolveBankImportDoubtfulRowRequest,
      ),
    onSuccess: (summary) => {
      storeImportSummary(queryClient, summary);
      void invalidateAfterImportChange(queryClient);
    },
  });
  return {resolveDoubtfulRow: mutateAsync};
}
