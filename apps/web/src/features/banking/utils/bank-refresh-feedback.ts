import {HttpError} from '@/utils/api';
import {formatRetryAfter} from '@/utils/retry-after';

import type {BankSyncRun} from '../types/bank-sync-run';

export function getBankRefreshErrorFeedback(error: Error) {
  if (error instanceof HttpError && error.status === 0) {
    return {
      message: 'Refresh not confirmed. Cannot reach Tempo. Check bank data before trying again.',
      tone: 'error' as const,
    };
  }
  if (error instanceof HttpError && error.status === 429) {
    return {
      message: `Refresh rate-limited. ${formatRetryAfter(error.retryAfterSeconds)}`,
      tone: 'warning' as const,
    };
  }
  return {message: `Refresh failed. ${error.message}`, tone: 'error' as const};
}

export function getBankRefreshFeedback(result: BankSyncRun) {
  const added = `${result.transactionsAdded} new transaction${result.transactionsAdded === 1 ? '' : 's'}.`;
  if (result.rateLimitSource === 'enable-banking') {
    const outcome =
      result.status === 'PARTIAL'
        ? `Refresh incomplete: bank rate limit. ${added}`
        : 'Refresh rate-limited.';
    return {
      title: 'Bank refresh rate-limited',
      message: `${outcome} ${result.errorMessage || 'The bank is temporarily limiting access.'} ${formatRetryAfter(result.retryAfterSeconds)}`,
      tone: 'warning' as const,
    };
  }
  if (result.status === 'FAILED') {
    return {
      title: 'Bank refresh failed',
      message: `Refresh failed. ${result.errorMessage || 'Please try again in a moment.'}`,
      tone: 'error' as const,
    };
  }
  if (result.status === 'PARTIAL') {
    return {
      title: 'Bank refresh incomplete',
      message: `Refresh incomplete. ${added} ${result.errorMessage || 'Some bank data could not be refreshed.'}`,
      tone: 'warning' as const,
    };
  }
  return {title: 'Bank refreshed', message: `Refresh complete. ${added}`, tone: 'success' as const};
}
