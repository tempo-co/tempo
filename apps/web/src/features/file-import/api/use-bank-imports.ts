import {type QueryClient, queryOptions, useQuery} from '@tanstack/react-query';
import type {BankImportList, BankImportSummary} from '@tempo/contracts';

import {invalidateBankDerivedData} from '@/features/banking/api/invalidate-bank-derived-data';
import {bankQueryKeys} from '@/features/banking/api/query-keys';
import {HttpError, NetworkError, SessionChangedError, api, isAuthError} from '@/utils/api';

export const bankImportQueryKeys = {
  root: ['bank-imports'] as const,
  list: ['bank-imports', 'list'] as const,
  doubtfulRows: (importId: string) => ['bank-imports', 'doubtful-rows', importId] as const,
  layouts: ['bank-imports', 'layouts'] as const,
};

/** The deployment answers 404 on every import route while file import is off. */
const isOff = (error: unknown) =>
  error instanceof HttpError && !(error instanceof NetworkError) && error.status === 404;

export const bankImportsQueryOptions = queryOptions({
  queryKey: bankImportQueryKeys.list,
  queryFn: () => api.get<BankImportList>('/bank-imports'),
  // A 404 is the answer, not a failure: import is off here. Like every query, it never retries a
  // signed-out session, a reply for another session or a rate limit.
  retry: (failureCount, error) =>
    !isOff(error) &&
    !isAuthError(error) &&
    !(error instanceof SessionChangedError) &&
    !(error instanceof HttpError && error.status === 429) &&
    failureCount < 3,
});

/**
 * Whether file import is on, from the import list (newest first), which is also the list the page shows.
 * `on` once the list loads, or once the API answers its route with an error of its own (the route is there);
 * `off` on a 404; `unknown` while loading or without an answer, when nothing of file import is shown.
 */
export function useBankImports() {
  const {data: list, error, isError, isFetching, refetch} = useQuery(bankImportsQueryOptions);
  const data = list?.imports;
  const state: 'on' | 'off' | 'unknown' =
    data !== undefined
      ? 'on'
      : isOff(error)
        ? 'off'
        : error instanceof HttpError && !(error instanceof NetworkError) && error.status >= 500
          ? 'on'
          : 'unknown';
  // Whether a table in no layout Tempo knows can have its columns worked out.
  const mapper = list?.mapper ?? false;
  return {data, error, isError, isFetching, refetch, state, mapper};
}

/**
 * After an import, a resolved row or an undo: the same caches a finished bank refresh reloads, plus the imports.
 */
export function invalidateAfterImportChange(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({queryKey: bankQueryKeys.connections}),
    queryClient.invalidateQueries({queryKey: bankImportQueryKeys.list}),
    invalidateBankDerivedData(queryClient),
  ]);
}

/** Puts an import's latest summary into the list, newest first, without waiting for the reload. */
export function storeImportSummary(queryClient: QueryClient, summary: BankImportSummary) {
  updateImports(queryClient, (imports) =>
    imports.some(({id}) => id === summary.id)
      ? imports.map((existing) => (existing.id === summary.id ? summary : existing))
      : [summary, ...imports],
  );
}

/** Changes the cached import list, keeping whether the mapper is on. */
export function updateImports(
  queryClient: QueryClient,
  update: (imports: BankImportSummary[]) => BankImportSummary[],
) {
  queryClient.setQueryData<BankImportList>(bankImportQueryKeys.list, (list) =>
    list ? {...list, imports: update(list.imports)} : list,
  );
}
