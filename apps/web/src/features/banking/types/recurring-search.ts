import {z} from 'zod';

import {recurringSeriesKeySchema} from './bank-transaction';

/** The Recurring page's address: which tab and view show, and which series is open beside them. */
export const recurringSearchSchema = z.object({
  /** All recurring; This month when absent. */
  tab: z.literal('all').optional().catch(undefined),
  /** This month on a calendar; a list when absent. */
  view: z.literal('calendar').optional().catch(undefined),
  /** The series whose details are open, so a link can open them and Back from a payment returns. */
  series: recurringSeriesKeySchema.optional().catch(undefined),
});

export type RecurringSearch = z.infer<typeof recurringSearchSchema>;
