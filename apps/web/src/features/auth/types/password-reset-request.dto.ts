import {z} from 'zod';

import {emailSchema} from '@/types/validation';

export const passwordResetRequestDtoSchema = z.object({
  email: emailSchema(),
});

export type PasswordResetRequestDto = z.infer<typeof passwordResetRequestDtoSchema>;
