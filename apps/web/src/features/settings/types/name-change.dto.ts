import {z} from 'zod';

export const nameChangeDtoSchema = z.object({
  name: z
    .string()
    .min(1, 'Please enter your name.')
    .max(255, 'Name must be less than 256 characters.'),
});

export type NameChangeDto = z.infer<typeof nameChangeDtoSchema>;
