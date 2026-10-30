import {z} from 'zod';

import {passwordSchema} from '@/types/validation';

export const passwordResetVerifyDtoSchema = z.object({
  newPassword: passwordSchema('Please enter your new password.'),
  token: z.string().uuid(),
});

export type PasswordResetVerifyDto = z.infer<typeof passwordResetVerifyDtoSchema>;
