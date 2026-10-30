import {Account} from '@modules/account/account.entity';

/** Redis key of an account's pending email change; one per account, so a new request replaces the last. */
export function emailChangeKey(prefix: string, accountId: Account['id']) {
	return `${prefix}:change:${accountId}`;
}
