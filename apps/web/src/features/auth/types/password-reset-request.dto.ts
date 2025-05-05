import {z} from 'zod';

export const passwordResetRequestDtoSchema = z.object({
  email: z
    .string()
    .min(1, 'Please enter your email address.')
    .max(255, 'Email address must be less than 256 characters.')
    .email('Please enter a valid email address.'),
});

export type PasswordResetRequestDto = z.infer<typeof passwordResetRequestDtoSchema>;
