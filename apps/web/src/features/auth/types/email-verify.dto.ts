import {z} from 'zod';

import {FLOWS} from './flow';

const CODE_REGEX = /^[0-9]{6}$/;

export const searchParamsSchema = z.object({
  code: z
    .union([z.string().regex(CODE_REGEX), z.number().int().min(100000).max(999999)])
    .optional()
    .catch(undefined),
  email: z.string().email().optional().catch(undefined),
  flow: z.enum(FLOWS).optional().catch(undefined),
});

export const emailVerifyDtoSchema = z.object({
  code: z.string().regex(CODE_REGEX, {message: 'Please enter the 6-digit verification code.'}),
  email: z.string().email(),
});

export type EmailVerifyDto = z.infer<typeof emailVerifyDtoSchema>;
