import {z} from 'zod';

import {Bank} from '@/types/bank';

export const bankAccountCreateDtoSchema = z.object({
  alias: z.string().max(50, 'Alias must be less than 50 characters.').optional(),
  bank: z.nativeEnum(Bank, {message: 'Please select a bank.'}),
  currency: z.string().min(3, {message: 'Please select a currency.'}).max(3),
});

export type BankAccountCreateDto = z.infer<typeof bankAccountCreateDtoSchema>;
