import {z} from 'zod';

import {logInDtoSchema} from './login.dto';

export const signUpDtoSchema = logInDtoSchema.extend({
  username: z
    .string()
    .min(1, 'Please enter your name.')
    .max(255, 'Name must be less than 256 characters.'),
});

export type SignUpDto = z.infer<typeof signUpDtoSchema>;
