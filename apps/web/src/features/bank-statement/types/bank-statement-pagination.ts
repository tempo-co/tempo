import z from 'zod';

import {paginationSearchParamsSchema} from '@/types/pagination';

export const BANK_STATEMENT_PAGE_SIZE_OPTIONS = [12, 24, 36, 48, 60];

export const bankStatementPaginationSearchParamsSchema = paginationSearchParamsSchema.extend({
  pageSize: z
    .number()
    .refine((val) => BANK_STATEMENT_PAGE_SIZE_OPTIONS.includes(val))
    .default(12),
});
