import {BadRequestException, Inject, Injectable} from '@nestjs/common';
import argon2 from 'argon2';
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
	PASSWORD_RESET_CONFIRMATION,
	PASSWORD_RESET_INVALID_TOKEN,
	PASSWORD_RESET_SUCCESS,
	PASSWORD_SAME_AS_OLD,
} from '../api/constants/api-messages.constants';

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
		const {accountId, key} = await this._getTokenData(token);

		await this._assertPasswordIsNew(accountId, password, key);

		const hash = await this.accountService.hashPassword(password);
		await this.accountService.updateFields(accountId, {password: hash});

		await this.redisClient.del(key);
		await this.sessionService.revokeAllOtherSessions(accountId, null);

		return {message: PASSWORD_RESET_SUCCESS};
	}

	private async _createToken(accountId: Account['id']) {
		const token: string = crypto.randomUUID();
		const key = `${this.REDIS_KEY}:${token}`;

		const expirationSeconds = Math.floor(this.EXPIRATION_MS / 1000);
		await this.redisClient.set(key, accountId, 'EX', expirationSeconds);
		return token;
	}

	private _createUrl(email: Account['email'], token: string) {
		return createWebUrl('/reset-password', this.WEB_BASE_URL, {email, token});
	}

	private async _getTokenData(token: string) {
		const key = `${this.REDIS_KEY}:${token}`;

		const accountId = await this.redisClient.get(key);
		if (!accountId) {
			throw new BadRequestException(PASSWORD_RESET_INVALID_TOKEN);
		}
		return {accountId, key};
	}

	private async _assertPasswordIsNew(accountId: Account['id'], newPassword: string, key: string) {
		const account = await this.accountService.findById(accountId);

		const isSamePassword = await argon2.verify(account.password, newPassword);
		if (isSamePassword) {
			await this.redisClient.del(key);
			throw new BadRequestException(PASSWORD_SAME_AS_OLD);
		}
	}
}
