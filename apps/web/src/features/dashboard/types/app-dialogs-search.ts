import {MERCHANT_GROUP_ID_PATTERN} from '@tempo/contracts';
import {z} from 'zod';

/** Dialogs any page can open over itself; in the URL so Back closes them and leaves the page as it was. */
export const appDialogsSearchSchema = z.object({
  /** The merchants dialog is open. */
  merchants: z.literal('open').optional().catch(undefined),
  /** The merchant whose details are open, so a link can open them and Back from a payment returns. */
  merchant: z.string().regex(new RegExp(MERCHANT_GROUP_ID_PATTERN)).optional().catch(undefined),
});

export type AppDialogsSearch = z.infer<typeof appDialogsSearchSchema>;
