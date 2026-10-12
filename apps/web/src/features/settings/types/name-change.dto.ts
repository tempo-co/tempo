import {z} from 'zod';

import {nameSchema} from '@/types/validation';

export const nameChangeDtoSchema = z.object({
  name: nameSchema.refine((name) => name.trim().length > 0, 'Please enter your name.'),
});

export type NameChangeDto = z.infer<typeof nameChangeDtoSchema>;
