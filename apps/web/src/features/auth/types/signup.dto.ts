import {z} from 'zod';

import {nameSchema} from '@/types/validation';

import {logInDtoSchema} from './login.dto';

export const signUpDtoSchema = logInDtoSchema.extend({
  name: nameSchema,
});

export type SignUpDto = z.infer<typeof signUpDtoSchema>;
