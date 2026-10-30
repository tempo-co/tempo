import {Inject, Injectable, Logger} from '@nestjs/common';
import Redis from 'ioredis';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {EmailService} from '@core/email/email.service';
import {REDIS} from '@core/redis/redis.constants';
import {SessionService} from '@core/session/session.service';
import {Account} from '@modules/account/account.entity';
import {BankingAuthorizationStateService} from '@modules/banking/services/banking-authorization-state.service';

import {AccountService} from './account.service';
import {emailChangeKey} from './email-change-key';

const ACCOUNT_DELETED_EMAIL_SUBJECT = 'Your Tempo account has been deleted';
export {ACCOUNT_DELETED_EMAIL_SUBJECT};
export const ACCOUNT_DELETED_MESSAGE = 'Account has been deleted.';
const SCAN_BATCH_SIZE = '250';

@Injectable()
export class AccountDeletionService {
	private readonly logger = new Logger(AccountDeletionService.name);

	constructor(
		private readonly accountService: AccountService,
		private readonly sessionService: SessionService,
		private readonly authorizationStateService: BankingAuthorizationStateService,
		private readonly dataSource: DataSource,
		private readonly emailService: EmailService,
		@Inject(REDIS) private readonly redis: Redis,
		private readonly configService: ConfigurationService,
	) {}

	async deleteAccount(accountId: Account['id'], password: Account['password']) {
		const account = await this.accountService.findById(accountId);
		await this.accountService.verifyPassword(account.password, password);

		// null for the current session id: revoke ALL of the account's sessions,
		// including the caller's own (same primitive the password-reset flow uses).
		await this.sessionService.revokeAllOtherSessions(accountId, null);

		const email = account.email;
		await this.dataSource.transaction(async (manager) => {
			await manager.delete(Account, {id: accountId});
		});

		await this.removeOutstandingTokens(accountId, email);
		try {
			await this.redis.del(emailChangeKey(this.configService.get('EMAIL_VERIFICATION_REDIS_KEY'), accountId));
		} catch {
			this.logger.warn('Failed to remove the pending email change during account deletion.');
		}
		try {
			await this.authorizationStateService.removeForAccount(accountId);
		} catch {
			this.logger.warn('Failed to remove pending bank authorization states during account deletion.');
		}
		try {
			await this.emailService.cancelPendingForAccount(accountId);
		} catch {
			this.logger.warn('Failed to cancel pending emails during account deletion.');
		}

		await this.sendFarewellEmail(account);
		return {message: ACCOUNT_DELETED_MESSAGE};
	}

	private async removeOutstandingTokens(accountId: Account['id'], email: Account['email']): Promise<void> {
		await Promise.all(
			this.ownershipMatchers(accountId, email).map(({prefix, owns}) => this.deleteOwnedKeys(`${prefix}:*`, owns)),
		);
	}

	private ownershipMatchers(accountId: Account['id'], email: Account['email']) {
		return [
			{
				prefix: this.configService.get('EMAIL_VERIFICATION_REDIS_KEY'),
				owns: (value: string) => value === email,
			},
			{
				prefix: this.configService.get('PASSWORD_RESET_REDIS_KEY'),
				owns: (value: string) => value === accountId,
			},
		];
	}

	private async deleteOwnedKeys(
		matchPattern: string,
		owns: (value: string) => Promise<boolean> | boolean,
	): Promise<void> {
		try {
			const ownedKeys = await this.scanOwnedKeys(matchPattern, owns);
			if (ownedKeys.length > 0) await this.redis.del(ownedKeys);
		} catch {
			this.logger.warn(`Failed to clean up keys matching "${matchPattern}" during account deletion.`);
		}
	}

	private async scanOwnedKeys(
		matchPattern: string,
		owns: (value: string) => Promise<boolean> | boolean,
	): Promise<string[]> {
		const ownedKeys: string[] = [];
		let cursor = '0';

		while (true) {
			const reply = await this.redis.scan(cursor, 'MATCH', matchPattern, 'COUNT', SCAN_BATCH_SIZE);
			cursor = reply[0];
			const keys = reply[1];
			if (keys.length > 0) {
				const values = await this.redis.mget(keys);
				for (let i = 0; i < keys.length; i++) {
					const value = values[i];
					if (value && (await owns(value))) ownedKeys.push(keys[i]);
				}
			}
			if (cursor === '0') break;
		}
		return ownedKeys;
	}

	private async sendFarewellEmail(account: Account): Promise<void> {
		try {
			await this.emailService.send(
				{
					to: account.email,
					subject: ACCOUNT_DELETED_EMAIL_SUBJECT,
					template: 'account-deleted',
					context: {name: account.name},
				},
				account.id,
			);
		} catch {
			this.logger.warn('Failed to enqueue the account-deleted email.');
		}
	}
}
