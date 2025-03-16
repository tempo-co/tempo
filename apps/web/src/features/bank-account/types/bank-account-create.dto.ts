import {z} from 'zod';

import {Bank} from '@/types/bank';

export const bankAccountCreateDtoSchema = z.object({
  alias: z.string().max(50, 'Alias must be less than 50 characters.').optional(),
  bank: z.nativeEnum(Bank, {message: 'Please select a bank.'}),
  currency: z.string().min(3).max(3).default('EUR'),
});

export type BankAccountCreateDto = z.infer<typeof bankAccountCreateDtoSchema>;
