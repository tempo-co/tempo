import type {Account} from '@tempo/contracts';

/** Synthetic HTTP account response; each call returns a fresh object. */
export function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Example Owner',
    email: 'user@example.com',
    isEmailVerified: true,
    baseCurrency: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
