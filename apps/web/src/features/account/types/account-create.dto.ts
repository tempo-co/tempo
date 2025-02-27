import {z} from 'zod';

import {Bank} from '@/types/bank';

export const accountCreateDtoSchema = z.object({
  alias: z.string().max(50, 'Alias must be less than 50 characters.').optional(),
  bank: z.nativeEnum(Bank, {message: 'Please select a bank.'}),
});

export type AccountCreateDto = z.infer<typeof accountCreateDtoSchema>;
