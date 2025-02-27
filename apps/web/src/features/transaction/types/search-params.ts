import {z} from 'zod';

import {Category} from '@/types/category';
import {paginationSearchParamsSchema} from '@/types/pagination';

const toDate = (val: unknown) => (typeof val === 'string' ? new Date(val) : val);

export const transactionSearchParamsSchema = paginationSearchParamsSchema.extend({
  categories: z.array(z.nativeEnum(Category)).optional(),
  startedAt: z
    .object({
      from: z.preprocess(toDate, z.date()),
      to: z.preprocess(toDate, z.date()).optional(),
    })
    .optional(),
});

export type TransactionSearchParams = z.infer<typeof transactionSearchParamsSchema>;
