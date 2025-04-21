import {z} from 'zod';

export const passwordChangeDtoSchema = z
  .object({
    newPassword: z
      .string()
      .min(1, 'Please enter your new password.')
      .min(8, 'Too short. Must be at least 8 characters.')
      .max(255, 'Too long. Must be less than 256 characters.'),
    confirmNewPassword: z
      .string()
      .min(1, 'Please confirm your new password.')
      .min(8, 'Too short. Must be at least 8 characters.')
      .max(255, 'Too long. Must be less than 256 characters.'),
    currentPassword: z
      .string()
      .min(1, 'Please enter your current password.')
      .min(8, 'Too short. Must be at least 8 characters.')
      .max(255, 'Too long. Must be less than 256 characters.'),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'Passwords do not match.',
    path: ['confirmNewPassword'],
  });

export type PasswordChangeDto = z.infer<typeof passwordChangeDtoSchema>;
