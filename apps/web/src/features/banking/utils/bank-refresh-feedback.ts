import {formatRetryAfter} from '@/utils/retry-after';

import type {BankSyncRun} from '../types/bank-sync-run';

/** Toast for a refresh that did not fully succeed; a successful refresh stays silent. */
export function getBankRefreshToast(result: BankSyncRun) {
  if (result.rateLimitSource === 'enable-banking') {
    return {
      title: 'Bank refresh rate-limited',
      description: `${result.errorMessage || 'The bank is temporarily limiting access.'} ${formatRetryAfter(result.retryAfterSeconds)}`,
    };
  }
  if (result.status === 'FAILED') {
    return {
      title: 'Bank refresh failed',
      description: result.errorMessage || 'Please try again in a moment.',
    };
  }
  if (result.status === 'PARTIAL') {
    return {
      title: 'Bank refresh incomplete',
      description: result.errorMessage || 'Some bank data could not be refreshed.',
    };
  }
  return null;
}
