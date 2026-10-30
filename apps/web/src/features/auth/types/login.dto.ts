import {z} from 'zod';

import {emailSchema, passwordSchema} from '@/types/validation';

export const logInDtoSchema = z.object({
  email: emailSchema(),
  password: passwordSchema(),
});

export type LogInDto = z.infer<typeof logInDtoSchema>;
