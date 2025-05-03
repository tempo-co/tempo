import {z} from 'zod';

export const emailChangeDtoSchema = z.object({
  newEmail: z
    .string()
    .min(1, 'Please enter your new email address.')
    .max(255, 'Email address must be less than 256 characters.')
    .email('Please enter a valid email address.'),
});

export type EmailChangeDto = z.infer<typeof emailChangeDtoSchema>;
