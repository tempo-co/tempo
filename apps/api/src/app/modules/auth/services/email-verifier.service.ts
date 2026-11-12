import {BadRequestException, Inject, Injectable, Logger} from '@nestjs/common';
import Redis from 'ioredis';
import ms from 'ms';
import crypto from 'node:crypto';

import {ConfigurationService} from '@core/config/config.service';
import {createWebUrl} from '@core/config/web-url';
import {EmailService} from '@core/email/email.service';
import {REDIS} from '@core/redis/redis.constants';
import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {emailChangeKey, hashSecret, signupCodeKey} from '@modules/account/auth-secret-keys';

import {
	EMAIL_ALREADY_VERIFIED,
	EMAIL_CHANGE_SUCCESS,
	EMAIL_INVALID_TOKEN,
	EMAIL_VERIFICATION_SENT,
} from '../api/constants/api-messages.constants';
import {PasswordResetService} from './password-reset.service';

type PendingEmailChange = {tokenHash: string; email: Account['email']};

export const EMAIL_CHANGE_VERIFICATION_SUBJECT = 'Confirm your new Tempo email';
export const EMAIL_CHANGED_SUBJECT = 'Your Tempo email was changed';

/** Wrong guesses a signup code survives; the last one deletes it, so only a resent code works. */
export const SIGNUP_CODE_MAX_ATTEMPTS = 5;

/**
 * Checks a signup code atomically: a match consumes it, a miss counts an attempt and deletes the
 * code on the last allowed one. KEYS[1] is the code hash, ARGV the submitted hash and the limit.
 */
const CHECK_SIGNUP_CODE_SCRIPT = `
local stored = redis.call('HGET', KEYS[1], 'codeHash')
if not stored then return 0 end
if stored == ARGV[1] then
	redis.call('DEL', KEYS[1])
	return 1
end
if redis.call('HINCRBY', KEYS[1], 'attempts', 1) >= tonumber(ARGV[2]) then
	redis.call('DEL', KEYS[1])
end
return 0
`;

@Injectable()
export class EmailVerifierService {
	private readonly logger = new Logger(EmailVerifierService.name);
	private readonly EXPIRATION_MS: number;
	private readonly REDIS_KEY;
	private readonly WEB_BASE_URL;

	constructor(
		@Inject(REDIS) private readonly redisClient: Redis,
		private readonly configService: ConfigurationService,
		private readonly emailService: EmailService,
		private readonly accountService: AccountService,
		private readonly passwordResetService: PasswordResetService,
	) {
		this.EXPIRATION_MS = ms(this.configService.get('EMAIL_VERIFICATION_EXPIRATION') as ms.StringValue);
		this.REDIS_KEY = this.configService.get('EMAIL_VERIFICATION_REDIS_KEY');
		this.WEB_BASE_URL = this.configService.get('WEB_BASE_URL');
	}

	checkEmailAvailability(email: Account['email']) {
		return this.accountService.validateEmailIsUnique(email);
	}

	async verifySignup(code: string, email: Account['email']) {
		const account = await this.accountService.findByEmail(email);
		if (!account) {
			throw new BadRequestException(EMAIL_INVALID_TOKEN);
		}

		const matched = await this.redisClient.eval(
			CHECK_SIGNUP_CODE_SCRIPT,
			1,
			signupCodeKey(this.REDIS_KEY, account.id),
			hashSecret(code),
			SIGNUP_CODE_MAX_ATTEMPTS,
		);
		if (matched !== 1) {
			throw new BadRequestException(EMAIL_INVALID_TOKEN);
		}

		if (account.isEmailVerified) {
			throw new BadRequestException(EMAIL_ALREADY_VERIFIED);
		}

		return await this.accountService.update(account.id, {isEmailVerified: true});
	}

	async sendWelcomeEmail(account: Account) {
		const {email, name, isEmailVerified} = account;

		if (isEmailVerified) {
			throw new BadRequestException(EMAIL_ALREADY_VERIFIED);
		}

		const code = await this._createCode(account.id);
		const verificationUrl = this._createUrl('/verify-email', {email, code});
		const expiration = ms(this.EXPIRATION_MS, {long: true});

		await this.emailService.send(
			{
				to: email,
				subject: 'Confirm your email for Tempo',
				template: 'welcome',
				context: {name, verificationUrl, code, expiration},
			},
			account.id,
		);

		return {message: EMAIL_VERIFICATION_SENT};
	}

	async requestEmailChange(account: Account, newEmail: Account['email'], currentPassword: Account['password']) {
		await this.accountService.verifyPassword(account.password, currentPassword);
		await this.accountService.validateEmailIsUnique(newEmail);

		const token = await this.accountService.withLockedAccount(account.id, () =>
			this._createEmailChangeToken(account.id, newEmail),
		);
		const verificationUrl = this._createUrl('/verify-email-change', {email: newEmail, token});
		const expiration = ms(this.EXPIRATION_MS, {long: true});

		await this.emailService.send(
			{
				to: newEmail,
				subject: EMAIL_CHANGE_VERIFICATION_SUBJECT,
				template: 'verify-new-email',
				context: {name: account.name, verificationUrl, expiration},
			},
			account.id,
		);
		return {message: EMAIL_VERIFICATION_SENT};
	}

	async verifyEmailChange(account: Account, token: string, newEmail: Account['email']) {
		const previousAccount = await this.accountService.withLockedAccount(account.id, async (current, repository) => {
			const key = emailChangeKey(this.REDIS_KEY, account.id);
			const pending = await this._getPendingEmailChange(key);
			if (pending?.tokenHash !== hashSecret(token) || pending.email !== newEmail) {
				throw new BadRequestException(EMAIL_INVALID_TOKEN);
			}

			await this.accountService.validateEmailIsUnique(newEmail);
			await repository.update({id: current.id}, {email: newEmail});
			await this.redisClient.del(key);
			return current;
		});

		// A reset link sent to the old address must not outlive the change.
		await this.passwordResetService.revokeForAccount(account.id);

		// The change is committed. A queue failure must not report a failed verification to the user.
		try {
			await this.emailService.send(
				{
					to: previousAccount.email,
					subject: EMAIL_CHANGED_SUBJECT,
					template: 'email-changed',
					context: {name: previousAccount.name, oldEmail: previousAccount.email, newEmail},
				},
				account.id,
			);
		} catch {
			this.logger.warn('Email changed, but the old-address notification could not be queued.');
		}
		return {message: EMAIL_CHANGE_SUCCESS};
	}
	private _createUrl(path: string, params: Record<string, string>) {
		return createWebUrl(path, this.WEB_BASE_URL, params);
	}

	/** Replaces the account's signup code, so an earlier one stops working, and resets its attempts. */
	private async _createCode(accountId: Account['id']) {
		const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
		const key = signupCodeKey(this.REDIS_KEY, accountId);
		const expirationSeconds = Math.floor(this.EXPIRATION_MS / 1000);

		await this.redisClient
			.multi()
			.del(key)
			.hset(key, 'codeHash', hashSecret(code), 'attempts', 0)
			.expire(key, expirationSeconds)
			.exec();
		return code;
	}

	private async _createEmailChangeToken(accountId: Account['id'], email: Account['email']) {
		const token: string = crypto.randomUUID();
		const pending: PendingEmailChange = {tokenHash: hashSecret(token), email};

		const expirationSeconds = Math.floor(this.EXPIRATION_MS / 1000);
		await this.redisClient.set(
			emailChangeKey(this.REDIS_KEY, accountId),
			JSON.stringify(pending),
			'EX',
			expirationSeconds,
		);
		return token;
	}

	private async _getPendingEmailChange(key: string): Promise<PendingEmailChange | null> {
		const value = await this.redisClient.get(key);
		return value ? (JSON.parse(value) as PendingEmailChange) : null;
	}
}
