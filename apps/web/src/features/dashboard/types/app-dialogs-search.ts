import {z} from 'zod';

import {recurringSeriesKeySchema} from '@/features/banking/types/bank-transaction';

/** Dialogs any page can open over itself; in the URL so Back closes them and leaves the page as it was. */
export const appDialogsSearchSchema = z.object({
  /** The recurring payments dialog is open. */
  recurring: z.literal('open').optional().catch(undefined),
  /** The recurring payment whose details are open, so Back from one of its payments returns to it. */
  series: recurringSeriesKeySchema.optional().catch(undefined),
});

export type AppDialogsSearch = z.infer<typeof appDialogsSearchSchema>;
