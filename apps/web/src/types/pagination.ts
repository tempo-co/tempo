import {z} from 'zod';

export const DEFAULT_PAGE_INDEX = 0;
export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

export const paginationSearchParamsSchema = z.object({
  pageIndex: z.number().nonnegative().default(DEFAULT_PAGE_INDEX),
  pageSize: z
    .number()
    .refine((val) => PAGE_SIZE_OPTIONS.includes(val))
    .default(DEFAULT_PAGE_SIZE),
});
