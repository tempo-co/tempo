import {z} from 'zod';

export const passwordResetVerifyDtoSchema = z.object({
  newPassword: z
    .string()
    .min(1, 'Please enter your new password.')
    .min(8, 'Too short. Must be at least 8 characters.')
    .max(255, 'Too long. Must be less than 256 characters.'),
  token: z.string().uuid(),
});

export type PasswordResetVerifyDto = z.infer<typeof passwordResetVerifyDtoSchema>;
