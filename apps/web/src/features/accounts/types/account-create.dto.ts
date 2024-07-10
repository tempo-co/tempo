import {Bank} from '@/types/bank';
import {z} from 'zod';

export const accountCreateDtoSchema = z.object({
  alias: z.string().max(50, 'Alias must be less than 50 characters.').optional(),
  bank: z.nativeEnum(Bank, {message: 'Bank is required.'}),
});

export type AccountCreateDto = z.infer<typeof accountCreateDtoSchema>;
