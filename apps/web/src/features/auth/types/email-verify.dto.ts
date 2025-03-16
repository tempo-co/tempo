import {z} from 'zod';

export const searchParamsSchema = z.object({
  code: z
    .union([
      z.string().regex(/^[0-9]{6}$/, {message: 'Please enter the 6-digit verification code.'}),
      z.number().int().min(100000).max(999999),
    ])
    .optional()
    .catch(undefined),
  returnTo: z.string().optional(),
});

export const emailVerifyDtoSchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, {message: 'Please enter the 6-digit verification code.'}),
});

export type EmailVerifyDto = z.infer<typeof emailVerifyDtoSchema>;
