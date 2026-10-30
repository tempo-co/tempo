import type {FetchStatus} from '@tanstack/react-query';

import {NetworkError} from './api';

type QueryResult = {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  fetchStatus: FetchStatus;
};

/**
 * Loading and error states that keep loaded data while Tempo does not answer. A request without a
 * response, or one waiting for the connection, leaves loaded data in place and reports missing data
 * as unavailable instead of loading. An error reply from Tempo still counts as an error.
 */
export function savedDataStatus({data, isPending, isError, error, fetchStatus}: QueryResult) {
  const isPaused = fetchStatus === 'paused';
  if (data === undefined) return {isPending: isPending && !isPaused, isError: isError || isPaused};
  return {isPending, isError: isError && !(error instanceof NetworkError)};
}
