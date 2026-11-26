import {MERCHANT_GROUP_ID_PATTERN} from '@tempo/contracts';
import {z} from 'zod';

import {PERIOD_PATTERN} from '../utils/insights-period';

/** The address of Insights: the period every figure covers, the cash flow's view, and what the rail shows. */
export const insightsSearchSchema = z.object({
  /**
   * `month`, `6m`, `all` or a calendar year; the last 12 months without it. The address reads a year as a number and
   * keeps it one, so it reads `?period=2025` rather than a quoted string.
   */
  period: z
    .union([z.string().regex(PERIOD_PATTERN), z.number().int().min(1900).max(2099)])
    .optional()
    .catch(undefined),
  /** The year and heat tables in place of the chart. */
  view: z.literal('table').optional().catch(undefined),
  /** The merchant whose details the rail shows. */
  merchant: z.string().regex(new RegExp(MERCHANT_GROUP_ID_PATTERN)).optional().catch(undefined),
  /** The rail lists every merchant of the period. */
  merchants: z.literal('all').optional().catch(undefined),
});

export type InsightsSearch = z.infer<typeof insightsSearchSchema>;
