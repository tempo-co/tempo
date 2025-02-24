import {fallback} from '@tanstack/zod-adapter';
import {z} from 'zod';

import {Category} from '@/types/category';

export const searchParamsSchema = z.object({
  pageIndex: fallback(z.number(), 0).default(0),
  pageSize: fallback(z.number(), 10).default(10),
  categories: z.array(z.nativeEnum(Category)).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;
