import {z} from 'zod';

import {emailSchema} from '@/types/validation';

export const emailChangeDtoSchema = z.object({
  newEmail: emailSchema('Please enter your new email address.'),
});

export type EmailChangeDto = z.infer<typeof emailChangeDtoSchema>;
