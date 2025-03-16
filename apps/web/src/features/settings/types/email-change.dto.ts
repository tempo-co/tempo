import {z} from 'zod';

export const emailChangeDtoSchema = z
  .object({
    newEmail: z
      .string()
      .min(1, 'Please enter your new email address.')
      .max(255, 'Email address must be less than 256 characters.')
      .email('Please enter a valid email address.'),
    confirmNewEmail: z
      .string()
      .min(1, 'Please confirm your new email address.')
      .max(255, 'Email address must be less than 256 characters.')
      .email('Please enter a valid email address.'),
    password: z
      .string()
      .min(1, 'Please enter your password.')
      .min(8, 'Too short. Must be at least 8 characters.')
      .max(255, 'Too long. Must be less than 256 characters.'),
  })
  .refine((data) => data.newEmail === data.confirmNewEmail, {
    message: 'Emails do not match.',
    path: ['confirmNewEmail'],
  });

export type EmailChangeDto = z.infer<typeof emailChangeDtoSchema>;
