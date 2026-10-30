import type {Account as AccountResponse} from '@tempo/contracts';

import {Account} from '../account.entity';

/** The public account fields; never the password hash. */
export function toAccountResponse(account: Account): AccountResponse {
	return {
		id: account.id,
		name: account.name,
		email: account.email,
		isEmailVerified: account.isEmailVerified,
		// A freshly saved signup entity omits the column.
		baseCurrency: account.baseCurrency ?? null,
		createdAt: account.createdAt.toISOString(),
		updatedAt: account.updatedAt.toISOString(),
	};
}
