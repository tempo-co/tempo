import {z} from 'zod';

import {nameSchema} from '@/types/validation';

export const nameChangeDtoSchema = z.object({
  name: nameSchema,
});

export type NameChangeDto = z.infer<typeof nameChangeDtoSchema>;
