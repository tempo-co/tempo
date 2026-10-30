import {z} from 'zod';

export const TOKEN_LIFETIMES = [
  {value: '30', label: '30 days', days: 30},
  {value: '90', label: '90 days', days: 90},
  {value: '365', label: '1 year', days: 365},
  {value: 'never', label: 'No expiration', days: null},
] as const;

export const createPersonalAccessTokenDtoSchema = z.object({
  name: z.string().trim().min(1, 'Enter a token name.').max(100, 'Use 100 characters or fewer.'),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]),
});

export type CreatePersonalAccessTokenDto = z.infer<typeof createPersonalAccessTokenDtoSchema>;
