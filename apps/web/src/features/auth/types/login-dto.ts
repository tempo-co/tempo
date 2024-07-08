import {z} from 'zod';

export const logInDtoSchema = z.object({
  email: z
    .string()
    .min(1, 'Please enter your email address.')
    .max(255, 'Email address must be less than 256 characters.')
    .email('Please enter a valid email address.'),
  password: z
    .string()
    .min(1, 'Please enter your password.')
    .min(8, 'Too short. Must be at least 8 characters.')
    .max(255, 'Too long. Must be less than 256 characters.'),
});

export type LogInDto = z.infer<typeof logInDtoSchema>;
