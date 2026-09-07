import {z} from 'zod';

export const accountDeleteDtoSchema = z.object({
  password: z
    .string()
    .min(1, 'Please enter your password.')
    .max(255, 'Too long. Must be less than 256 characters.'),
});

export type AccountDeleteDto = z.infer<typeof accountDeleteDtoSchema>;
