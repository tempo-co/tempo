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
import {emailChangeKey} from '@modules/account/email-change-key';

import {
	EMAIL_ALREADY_VERIFIED,
	EMAIL_CHANGE_SUCCESS,
	EMAIL_INVALID_TOKEN,
	EMAIL_VERIFICATION_SENT,
} from '../api/constants/api-messages.constants';

type PendingEmailChange = {token: string; email: Account['email']};

export const EMAIL_CHANGE_VERIFICATION_SUBJECT = 'Confirm your new Tempo email';
export const EMAIL_CHANGED_SUBJECT = 'Your Tempo email was changed';

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
	) {
		this.EXPIRATION_MS = ms(this.configService.get('EMAIL_VERIFICATION_EXPIRATION') as ms.StringValue);
		this.REDIS_KEY = this.configService.get('EMAIL_VERIFICATION_REDIS_KEY');
		this.WEB_BASE_URL = this.configService.get('WEB_BASE_URL');
	}

	checkEmailAvailability(email: Account['email']) {
		return this.accountService.validateEmailIsUnique(email);
	}

	async verifySignup(code: string, email: Account['email']) {
		const expectedEmail = await this._getEmailBySecret(code);
		if (expectedEmail !== email) {
			throw new BadRequestException(EMAIL_INVALID_TOKEN);
		}

		const account = await this.accountService.findByEmail(email);
		if (!account) {
			throw new BadRequestException(EMAIL_INVALID_TOKEN);
		}

		if (account.isEmailVerified) {
			throw new BadRequestException(EMAIL_ALREADY_VERIFIED);
		}

		const updatedAccount = await this.accountService.update(account.id, {isEmailVerified: true});
		await this._removeSecret(code);
		return updatedAccount;
	}

	async sendWelcomeEmail(account: Account) {
		const {email, name, isEmailVerified} = account;

		if (isEmailVerified) {
			throw new BadRequestException(EMAIL_ALREADY_VERIFIED);
		}

		const code = await this._createCode(email);
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

	async requestEmailChange(account: Account, newEmail: Account['email']) {
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
			if (pending?.token !== token || pending.email !== newEmail) {
				throw new BadRequestException(EMAIL_INVALID_TOKEN);
			}

			await this.accountService.validateEmailIsUnique(newEmail);
			await repository.update({id: current.id}, {email: newEmail});
			await this.redisClient.del(key);
			return current;
		});

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

	private async _createCode(email: Account['email']) {
		while (true) {
			const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
			const key = `${this.REDIS_KEY}:${code}`;

			try {
				await this._getEmailBySecret(code);
			} catch {
				const expirationSeconds = Math.floor(this.EXPIRATION_MS / 1000);
				await this.redisClient.set(key, email, 'EX', expirationSeconds);
				return code;
			}
		}
	}

	private async _createEmailChangeToken(accountId: Account['id'], email: Account['email']) {
		const token: string = crypto.randomUUID();
		const pending: PendingEmailChange = {token, email};

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

	private async _getEmailBySecret(secret: string) {
		const key = `${this.REDIS_KEY}:${secret}`;
		const email = await this.redisClient.get(key);

		if (!email) {
			throw new BadRequestException(EMAIL_INVALID_TOKEN);
		}
		return email;
	}

	private async _removeSecret(secret: string) {
		const key = `${this.REDIS_KEY}:${secret}`;
		await this.redisClient.del(key);
	}
}
