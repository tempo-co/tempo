import type {BankSyncRun} from '../../src/features/banking/types/bank-sync-run';

export const successfulBankRefresh = {
  id: '00000000-0000-4000-8000-000000000099',
  status: 'SUCCEEDED',
  startedAt: '2026-10-01T12:00:00.000Z',
  finishedAt: '2026-10-01T12:00:01.000Z',
  requestedFrom: '2026-09-01',
  requestedTo: '2026-10-01',
  accountsFetched: 2,
  balancesFetched: 2,
  transactionsFetched: 5,
  transactionsAdded: 0,
  errorMessage: null,
  rateLimitSource: null,
  retryAfterSeconds: null,
} satisfies BankSyncRun;
