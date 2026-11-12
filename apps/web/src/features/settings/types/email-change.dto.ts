import {z} from 'zod';

import {emailSchema, passwordSchema} from '@/types/validation';

export const emailChangeDtoSchema = z.object({
  newEmail: emailSchema('Please enter your new email address.'),
  currentPassword: passwordSchema('Please enter your current password.'),
});

export type EmailChangeDto = z.infer<typeof emailChangeDtoSchema>;
