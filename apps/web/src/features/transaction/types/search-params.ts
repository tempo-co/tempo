import {fallback} from '@tanstack/zod-adapter';
import {z} from 'zod';

import {Category} from '@/types/category';

const DEFAULT_PAGE_INDEX = 0;
const DEFAULT_PAGE_SIZE = 10;

export const transactionSearchParamsSchema = z.object({
  pageIndex: fallback(z.number(), DEFAULT_PAGE_INDEX).default(DEFAULT_PAGE_INDEX),
  pageSize: fallback(z.number(), DEFAULT_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  categories: z.array(z.nativeEnum(Category)).optional(),
});

export type TransactionSearchParams = z.infer<typeof transactionSearchParamsSchema>;
