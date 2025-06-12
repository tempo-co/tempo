import {z} from 'zod';

export const searchParamsSchema = z.object({
  token: z.string().uuid().optional().catch(undefined),
  email: z.string().email().optional().catch(undefined),
});

export type EmailChangeVerifySearchParams = z.infer<typeof searchParamsSchema>;

export const emailChangeVerifyDtoSchema = z.object({
  token: z.string().uuid(),
  email: z.string().email(),
});

export type EmailChangeVerifyDto = z.infer<typeof emailChangeVerifyDtoSchema>;
