import {z} from 'zod';

import {passwordSchema} from '@/types/validation';

export const passwordChangeDtoSchema = z.object({
  newPassword: passwordSchema('Please enter your new password.'),
  currentPassword: passwordSchema('Please enter your current password.'),
});

export type PasswordChangeDto = z.infer<typeof passwordChangeDtoSchema>;
