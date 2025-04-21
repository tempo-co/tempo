import {z} from 'zod';

export const sessionRevokeDtoSchema = z.object({
  password: z
    .string()
    .min(1, 'Please enter your password.')
    .min(8, 'Too short. Must be at least 8 characters.')
    .max(255, 'Too long. Must be less than 256 characters.'),
});

export type SessionRevokeDto = z.infer<typeof sessionRevokeDtoSchema>;
