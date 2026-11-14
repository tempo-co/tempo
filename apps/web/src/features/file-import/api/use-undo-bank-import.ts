import {useMutation, useQueryClient} from '@tanstack/react-query';

import {api} from '@/utils/api';

import {invalidateAfterImportChange, updateImports} from './use-bank-imports';

/** Undoes an import: the API deletes the rows it still owns and any account it created that is left empty. */
export function useUndoBankImport() {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation({
    mutationFn: (importId: string) => api.delete<null>(`/bank-imports/${importId}`),
    onSuccess: (_, importId) => {
      // The row turns undone at once; the reload brings the API's time and accounts.
      const undoneAt = new Date().toISOString();
      updateImports(queryClient, (imports) =>
        imports.map((summary) =>
          summary.id === importId ? {...summary, undoneAt, rowsDoubtful: 0} : summary,
        ),
      );
    },
    onSettled: () => invalidateAfterImportChange(queryClient),
  });
  return {undoBankImport: mutateAsync, isPending};
}
