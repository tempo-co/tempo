import {z} from 'zod';

export const usernameChangeDtoSchema = z.object({
  username: z
    .string()
    .min(1, 'Please enter your name.')
    .max(255, 'Name must be less than 256 characters.'),
});

export type UsernameChangeDto = z.infer<typeof usernameChangeDtoSchema>;
