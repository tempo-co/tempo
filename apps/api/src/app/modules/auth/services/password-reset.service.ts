import {BadRequestException, Inject, Injectable} from '@nestjs/common';
import type {CodedErrorResponse, PasswordResetErrorCode} from '@tempo/contracts';
import Redis from 'ioredis';
import ms from 'ms';
import crypto from 'node:crypto';

import {ConfigurationService} from '@core/config/config.service';
import {createWebUrl} from '@core/config/web-url';
import {EmailService} from '@core/email/email.service';
import {REDIS} from '@core/redis/redis.constants';
import {SessionService} from '@core/session/session.service';
import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {
	hashSecret,
	passwordResetAccountKey,
	passwordResetTokenKey,
	revokePasswordResetToken,
} from '@modules/account/auth-secret-keys';

import {
	PASSWORD_RESET_CONFIRMATION,
	PASSWORD_RESET_INVALID_TOKEN,
	PASSWORD_RESET_SUCCESS,
	PASSWORD_SAME_AS_OLD,
} from '../api/constants/api-messages.constants';

const resetError = (code: PasswordResetErrorCode, message: string) =>
	new BadRequestException({
		statusCode: 400,
		error: 'Bad Request',
		message,
		code,
	} satisfies CodedErrorResponse<PasswordResetErrorCode>);

/**
 * An account has at most one live reset link: a new request replaces it, and a reset, password
 * change or email change ends it. Redis holds only the token's hash.
 */
@Injectable()
export class PasswordResetService {
	private readonly REDIS_KEY;
	private readonly WEB_BASE_URL;
	private readonly EXPIRATION_MS: number;

	constructor(
		private readonly accountService: AccountService,
		private readonly emailService: EmailService,
		private readonly configService: ConfigurationService,
		@Inject(REDIS) private readonly redisClient: Redis,
		private readonly sessionService: SessionService,
	) {
		this.REDIS_KEY = this.configService.get('PASSWORD_RESET_REDIS_KEY');
		this.WEB_BASE_URL = this.configService.get('WEB_BASE_URL');
		this.EXPIRATION_MS = ms(this.configService.get('PASSWORD_RESET_EXPIRATION') as ms.StringValue);
	}

	async requestPasswordReset(email: Account['email']) {
		const account = await this.accountService.findByEmail(email);
		if (!account) {
			return {message: PASSWORD_RESET_CONFIRMATION};
		}

		const token = await this._createToken(account.id);
		const resetUrl = this._createUrl(account.email, token);
		const expiration = ms(this.EXPIRATION_MS, {long: true});

		await this.emailService.send(
			{
				to: account.email,
				subject: 'Reset your Tempo password',
				template: 'reset-password',
				context: {name: account.name, resetUrl, expiration},
			},
			account.id,
		);
		return {message: PASSWORD_RESET_CONFIRMATION};
	}

	async resetPassword(password: Account['password'], token: string) {
		const tokenKey = passwordResetTokenKey(this.REDIS_KEY, hashSecret(token));
		const accountId = await this.redisClient.get(tokenKey);
		if (!accountId) {
			throw resetError('invalid_token', PASSWORD_RESET_INVALID_TOKEN);
		}

		// Checked before the token is consumed, so the link still works with a different password.
		await this._assertPasswordIsNew(accountId, password);
		const hash = await this.accountService.hashPassword(password);

		// GETDEL lets exactly one of concurrent submissions of the same link through.
		if ((await this.redisClient.getdel(tokenKey)) !== accountId) {
			throw resetError('invalid_token', PASSWORD_RESET_INVALID_TOKEN);
		}
		await this.accountService.updateFields(accountId, {password: hash});
		await this.revokeForAccount(accountId);
		await this.sessionService.revokeAllCredentials(accountId, null);

		return {message: PASSWORD_RESET_SUCCESS};
	}

	/** Ends the account's live reset link, if it has one. */
	revokeForAccount(accountId: Account['id']) {
		return revokePasswordResetToken(this.redisClient, this.REDIS_KEY, accountId);
	}

	private async _createToken(accountId: Account['id']) {
		const token: string = crypto.randomUUID();
		const tokenHash = hashSecret(token);
		const expirationSeconds = Math.floor(this.EXPIRATION_MS / 1000);

		await this.redisClient.set(
			passwordResetTokenKey(this.REDIS_KEY, tokenHash),
			accountId,
			'EX',
			expirationSeconds,
		);
		// SET ... GET swaps atomically, so every replaced token is deleted by the request that replaced it.
		const previousHash = await this.redisClient.set(
			passwordResetAccountKey(this.REDIS_KEY, accountId),
			tokenHash,
			'EX',
			expirationSeconds,
			'GET',
		);
		if (previousHash) await this.redisClient.del(passwordResetTokenKey(this.REDIS_KEY, previousHash));
		return token;
	}

	private _createUrl(email: Account['email'], token: string) {
		return createWebUrl('/reset-password', this.WEB_BASE_URL, {email, token});
	}

	private async _assertPasswordIsNew(accountId: Account['id'], newPassword: string) {
		const account = await this.accountService.findById(accountId);
		if (await this.accountService.isPasswordValid(account.password, newPassword)) {
			throw resetError('password_unchanged', PASSWORD_SAME_AS_OLD);
		}
	}
}
