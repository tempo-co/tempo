import {z} from 'zod';

import {MONTH_PATTERN} from '../utils/month';

/** The address of a reports page, Home or Insights. */
export const reportsSearchSchema = z.object({
  /** The month open over the page; in the URL so Back closes it. */
  month: z.string().regex(MONTH_PATTERN).optional().catch(undefined),
});
