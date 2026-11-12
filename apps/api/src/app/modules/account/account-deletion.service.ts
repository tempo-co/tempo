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
import {emailChangeKey, revokePasswordResetToken, signupCodeKey} from './auth-secret-keys';

const ACCOUNT_DELETED_EMAIL_SUBJECT = 'Your Tempo account has been deleted';
export {ACCOUNT_DELETED_EMAIL_SUBJECT};
export const ACCOUNT_DELETED_MESSAGE = 'Account has been deleted.';

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
		await this.sessionService.revokeAllCredentials(accountId, null);

		await this.dataSource.transaction(async (manager) => {
			await manager.delete(Account, {id: accountId});
		});

		await this.removeOutstandingTokens(accountId);
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

	/** Ends the account's signup code, pending email change and password reset link. */
	private async removeOutstandingTokens(accountId: Account['id']): Promise<void> {
		const emailPrefix = this.configService.get('EMAIL_VERIFICATION_REDIS_KEY');
		try {
			await this.redis.del(signupCodeKey(emailPrefix, accountId), emailChangeKey(emailPrefix, accountId));
			await revokePasswordResetToken(this.redis, this.configService.get('PASSWORD_RESET_REDIS_KEY'), accountId);
		} catch {
			this.logger.warn('Failed to remove outstanding codes and links during account deletion.');
		}
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
