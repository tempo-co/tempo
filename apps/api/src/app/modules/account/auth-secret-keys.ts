import Redis from 'ioredis';
import {createHash} from 'node:crypto';

import {Account} from '@modules/account/account.entity';

/** Emailed tokens and codes are stored and looked up by this hash, so Redis never holds a usable one. */
export function hashSecret(secret: string) {
	return createHash('sha256').update(secret).digest('hex');
}

/** Redis key of an account's pending email change; one per account, so a new request replaces the last. */
export function emailChangeKey(prefix: string, accountId: Account['id']) {
	return `${prefix}:change:${accountId}`;
}

/** Redis hash of an account's signup code and its wrong attempts; one per account, so a resend replaces it. */
export function signupCodeKey(prefix: string, accountId: Account['id']) {
	return `${prefix}:signup:${accountId}`;
}

/** Redis key holding the hash of an account's one live password reset token. */
export function passwordResetAccountKey(prefix: string, accountId: Account['id']) {
	return `${prefix}:account:${accountId}`;
}

/** Redis key mapping a password reset token's hash to its account. */
export function passwordResetTokenKey(prefix: string, tokenHash: string) {
	return `${prefix}:token:${tokenHash}`;
}

/** Ends an account's live password reset link, if it has one. */
export async function revokePasswordResetToken(redis: Redis, prefix: string, accountId: Account['id']) {
	const tokenHash = await redis.getdel(passwordResetAccountKey(prefix, accountId));
	if (tokenHash) await redis.del(passwordResetTokenKey(prefix, tokenHash));
}
