import {UnauthorizedException} from '@nestjs/common';
import Redis from 'ioredis';
import {DataSource, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {EmailService} from '@core/email/email.service';
import {SessionService} from '@core/session/session.service';
import {Account} from '@modules/account/account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankingAuthorizationStateService} from '@modules/banking/services/banking-authorization-state.service';
import {BankingConsentRevocationService} from '@modules/banking/services/banking-consent-revocation.service';

import {AccountDeletionService} from './account-deletion.service';
import {AccountService} from './account.service';

function buildService() {
	const account = {
		id: 'account-id',
		name: 'Test Account',
		email: 'account@test.com',
		isEmailVerified: true,
		password: 'argon2-hash',
		createdAt: new Date(),
		updatedAt: new Date(),
	} as Account;

	const accountService = {
		findById: jest.fn().mockResolvedValue(account),
		verifyPassword: jest.fn().mockResolvedValue(undefined),
	};
	const sessionService = {
		revokeAllCredentials: jest.fn().mockResolvedValue({message: ''}),
	};
	const authorizationStateService = {
		removeForAccount: jest.fn().mockResolvedValue(0),
	};
	const dataSource = {
		transaction: jest.fn(async (callback: (manager: unknown) => Promise<void>) =>
			callback({delete: jest.fn().mockResolvedValue({affected: 1})}),
		),
	};
	const emailService = {
		send: jest.fn().mockResolvedValue(undefined),
		cancelPendingForAccount: jest.fn().mockResolvedValue(undefined),
	};
	const redis = {
		del: jest.fn().mockResolvedValue(1),
		getdel: jest.fn().mockResolvedValue(null),
	};
	const configService = {
		get: jest.fn().mockReturnValue('test-key-prefix'),
	};
	const consentRevocationService = {
		revokeSessions: jest.fn().mockResolvedValue(undefined),
	};
	const bankConnectionRepository = {
		find: jest.fn().mockResolvedValue([]),
	};

	const service = new AccountDeletionService(
		accountService as unknown as AccountService,
		sessionService as unknown as SessionService,
		authorizationStateService as unknown as BankingAuthorizationStateService,
		dataSource as unknown as DataSource,
		emailService as unknown as EmailService,
		redis as unknown as Redis,
		configService as unknown as ConfigurationService,
		consentRevocationService as unknown as BankingConsentRevocationService,
		bankConnectionRepository as unknown as Repository<BankConnection>,
	);

	return {
		service,
		account,
		accountService,
		sessionService,
		authorizationStateService,
		dataSource,
		emailService,
		redis,
		consentRevocationService,
	};
}

describe('AccountDeletionService', () => {
	it('rejects with UnauthorizedException when the password confirmation fails and performs no destructive step', async () => {
		const {service, accountService, sessionService, dataSource, consentRevocationService} = buildService();
		accountService.verifyPassword.mockRejectedValue(new UnauthorizedException());

		await expect(service.deleteAccount('account-id', 'wrong-password')).rejects.toThrow(UnauthorizedException);
		expect(sessionService.revokeAllCredentials).not.toHaveBeenCalled();
		expect(consentRevocationService.revokeSessions).not.toHaveBeenCalled();
		expect(dataSource.transaction).not.toHaveBeenCalled();
	});

	it('cancels pending emails for the deleted account', async () => {
		const {service, account, emailService} = buildService();

		await service.deleteAccount(account.id, 'correct-password');

		expect(emailService.cancelPendingForAccount).toHaveBeenCalledWith(account.id);
	});

	it('succeeds even when post-deletion cleanup fails', async () => {
		const {service, account, redis, authorizationStateService, emailService} = buildService();
		redis.del.mockRejectedValue(new Error('redis down'));
		authorizationStateService.removeForAccount.mockRejectedValue(new Error('redis down'));
		emailService.send.mockRejectedValue(new Error('queue down'));

		await expect(service.deleteAccount(account.id, 'correct-password')).resolves.toEqual({
			message: 'Account has been deleted.',
		});
	});
});
