import {z} from 'zod';

export const bankSyncRunSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['SUCCEEDED', 'PARTIAL', 'FAILED']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  requestedFrom: z.string().nullable(),
  requestedTo: z.string().nullable(),
  accountsFetched: z.number(),
  balancesFetched: z.number(),
  transactionsFetched: z.number(),
  transactionsAdded: z.number(),
  errorMessage: z.string().nullable(),
  rateLimitSource: z.literal('enable-banking').nullable(),
  retryAfterSeconds: z.number().nullable(),
});

export type BankSyncRun = z.infer<typeof bankSyncRunSchema>;
