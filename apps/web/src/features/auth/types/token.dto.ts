import {z} from 'zod';

export const passwordResetSearchParamsSchema = z.object({
  token: z.string().uuid().optional().catch(undefined),
  email: z.string().email().optional().catch(undefined),
});

export type PasswordResetSearchParams = z.infer<typeof passwordResetSearchParamsSchema>;
