import {z} from 'zod';

/** Search params for emailed token links (password reset, email change verification). */
export const tokenSearchParamsSchema = z.object({
  token: z.string().uuid().optional().catch(undefined),
  email: z.string().email().optional().catch(undefined),
});

export type TokenSearchParams = z.infer<typeof tokenSearchParamsSchema>;
