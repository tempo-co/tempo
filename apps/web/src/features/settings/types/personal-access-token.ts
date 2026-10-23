import {z} from 'zod';

export const personalAccessTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.literal('read')),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  /** Null when the token never expires. */
  expiresAt: z.string().nullable(),
});

export type PersonalAccessToken = z.infer<typeof personalAccessTokenSchema>;
export type CreatedPersonalAccessToken = PersonalAccessToken & {token: string};
