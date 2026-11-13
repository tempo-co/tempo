import {
	BadGatewayException,
	BadRequestException,
	HttpException,
	Injectable,
	InternalServerErrorException,
	Logger,
	ServiceUnavailableException,
} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {createHash} from 'node:crypto';
import {DataSource, EntityManager, In, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';

import {
	BANKING_AUTHORIZATION_START_FAILED,
	BANKING_SELECTED_BANK_UNAVAILABLE,
	BANKING_SERVICE_UNAVAILABLE,
} from '../api/constants/banking-messages.constants';
import {BankConnectionAuthorizeDto} from '../api/dtos/bank-connection-authorize.dto';
import {BankConnectionCallbackDto} from '../api/dtos/bank-connection-callback.dto';
import {BankAccount} from '../bank-account.entity';
import {BankConnectionCallbackResult} from '../bank-connection-callback-result';
import {BankConnection} from '../bank-connection.entity';
import {normalizeBankCode, truncate} from '../banking.utils';
import {EnableBankingAccount, EnableBankingSession} from '../enable-banking.types';
import {BankingAuthorizationStateError} from '../errors/banking-authorization-state.error';
import {FileConnectionNotSyncableException} from '../errors/file-connection-not-syncable.exception';
import {AspspCatalogService} from './aspsp-catalog.service';
import {
	ensureBankingIntegrationEnabled,
	isBankingIntegrationEnabled,
	releaseLockSafely,
	safeErrorCode,
} from './bank-connection.utils';
import {BankingAuthorizationStateService} from './banking-authorization-state.service';
import {type BankingConnectionLock, BankingConnectionLockService} from './banking-connection-lock.service';
import {BankingEncryptionService} from './banking-encryption.service';
import {BankingSyncQueueService} from './banking-sync-queue.service';
import {
	BANK_CONNECTION_PROVIDERS,
	BANK_CONNECTION_STATUSES,
	BANK_SYNC_STATUSES,
	DESTRUCTIVE_CONNECTION_STATUSES,
	FILE_CONNECTION_ASPSP,
} from './banking-sync.constants';
import {EnableBankingClient, EnableBankingClientError} from './enable-banking.client';
import {OwnTransferService} from './own-transfer.service';

const PROVIDER = BANK_CONNECTION_PROVIDERS.ENABLE_BANKING;
const AUTHORIZATION_LOCK_WAIT_MS = 10_000;

/** Starts bank authorizations and turns the provider callback into an authorized connection. */
@Injectable()
export class BankAuthorizationService {
	private readonly logger = new Logger(BankAuthorizationService.name);

	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		private readonly accountService: AccountService,
		private readonly configurationService: ConfigurationService,
		private readonly dataSource: DataSource,
		private readonly enableBankingClient: EnableBankingClient,
		private readonly aspspCatalogService: AspspCatalogService,
		private readonly authorizationStateService: BankingAuthorizationStateService,
		private readonly encryptionService: BankingEncryptionService,
		private readonly connectionLockService: BankingConnectionLockService,
		private readonly bankingSyncQueueService: BankingSyncQueueService,
		private readonly ownTransferService: OwnTransferService,
	) {}

	async startAuthorization(
		accountId: Account['id'],
		dto: BankConnectionAuthorizeDto,
	): Promise<{authorizationUrl: string}> {
		ensureBankingIntegrationEnabled(this.configurationService);
		const aspspName = dto.aspspName.trim();
		const aspspCountry = dto.aspspCountry.toUpperCase();
		// Re-authorizing names the connection's bank; the imported-files connection has none.
		if (aspspCountry === FILE_CONNECTION_ASPSP.country) throw new FileConnectionNotSyncableException();
		const aspsps = await this.aspspCatalogService.getAspsps(aspspCountry);
		const aspsp = aspsps.find((candidate) => candidate.name === aspspName && candidate.country === aspspCountry);

		if (!aspsp) {
			throw new BadRequestException(BANKING_SELECTED_BANK_UNAVAILABLE);
		}

		const account = await this.accountService.findById(accountId);
		const reusableConnection = await this.bankConnectionRepository.findOne({
			where: this.getReusableConnectionWhere(account.id, aspsp.name, aspsp.country),
			order: {createdAt: 'DESC'},
		});
		const connection = await this.bankConnectionRepository.save(
			this.bankConnectionRepository.create({
				account,
				provider: PROVIDER,
				aspspName: aspsp.name,
				aspspCountry: aspsp.country,
				status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
			}),
		);

		let state: string | undefined;

		try {
			state = await this.authorizationStateService.create({
				accountId: account.id,
				connectionId: connection.id,
				aspspName: aspsp.name,
				aspspCountry: aspsp.country,
				replacesConnectionId: reusableConnection?.id ?? null,
			});
			const authorizationStateHash = this.hashAuthorizationState(state);
			const bindingResult = await this.bankConnectionRepository.update(
				{id: connection.id, status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION},
				{authorizationStateHash},
			);
			if (bindingResult.affected === 0) {
				throw new Error('Bank connection authorization was superseded.');
			}

			const authorization = await this.enableBankingClient.startAuthorization({
				state,
				redirectUrl: this.configurationService.get('ENABLE_BANKING_REDIRECT_URL'),
				psuId: account.id,
				aspsp: {name: aspsp.name, country: aspsp.country},
				validUntil: new Date(Date.now() + aspsp.maximumConsentValiditySeconds * 1000).toISOString(),
			});

			await this.authorizationStateService.setAuthorizationId(state, authorization.authorizationId);

			return {authorizationUrl: authorization.url};
		} catch (error) {
			if (state) {
				await this.authorizationStateService.delete(state).catch(() => undefined);
				await this.updatePendingAuthorization(
					{
						id: connection.id,
						status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
						authorizationStateHash: this.hashAuthorizationState(state),
					},
					BANK_CONNECTION_STATUSES.FAILED,
				);
			} else {
				await this.bankConnectionRepository.update(
					{id: connection.id, status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION},
					{status: BANK_CONNECTION_STATUSES.FAILED, authorizationStateHash: null},
				);
			}

			throw this.toAuthorizationStartException(error);
		}
	}

	async handleCallback(query: BankConnectionCallbackDto): Promise<BankConnectionCallbackResult> {
		if (!isBankingIntegrationEnabled(this.configurationService)) return 'error';

		try {
			return await this.handleCallbackInternal(query);
		} catch (error) {
			this.logger.warn(`Banking authorization callback failed: ${safeErrorCode(error)}`);
			return 'error';
		}
	}

	private async handleCallbackInternal(query: BankConnectionCallbackDto): Promise<BankConnectionCallbackResult> {
		const consumption = await this.authorizationStateService.consumeWithStatus(query.state);
		if (!consumption) {
			await this.expireAuthorization(query.state);
			return 'error';
		}
		if (consumption.status === 'already_consumed') return 'error';
		if (consumption.status !== 'consumed') {
			await this.expireAuthorization(query.state);
			return 'error';
		}
		if (!query.state) return 'error';

		const state = consumption.state;
		const authorizationStateHash = this.hashAuthorizationState(query.state);
		const pendingConnectionCriteria = {
			id: state.connectionId,
			status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
			authorizationStateHash,
		};
		const connection = await this.bankConnectionRepository.findOne({
			where: {...pendingConnectionCriteria, account: {id: state.accountId}},
		});
		if (!connection) return 'error';

		if (query.error) {
			const status = this.isCancellation(query.error)
				? BANK_CONNECTION_STATUSES.CANCELLED
				: BANK_CONNECTION_STATUSES.FAILED;
			const transitioned = await this.updatePendingAuthorization(pendingConnectionCriteria, status);
			return transitioned && status === BANK_CONNECTION_STATUSES.CANCELLED ? 'cancelled' : 'error';
		}

		if (!query.code) {
			await this.updatePendingAuthorization(pendingConnectionCriteria, BANK_CONNECTION_STATUSES.FAILED);
			return 'error';
		}

		try {
			const session = await this.enableBankingClient.createSession(query.code);
			await this.persistAuthorizedSession(
				state.accountId,
				connection.id,
				authorizationStateHash,
				state.replacesConnectionId,
				session,
			);
			return 'connected';
		} catch (error) {
			this.logger.warn(`Enable Banking authorization failed: ${safeErrorCode(error)}`);
			await this.updatePendingAuthorization(pendingConnectionCriteria, BANK_CONNECTION_STATUSES.FAILED);
			return 'error';
		}
	}

	private async persistAuthorizedSession(
		accountId: Account['id'],
		connectionId: string,
		authorizationStateHash: string,
		replacesConnectionId: string | null | undefined,
		session: EnableBankingSession,
	): Promise<void> {
		const consentValidUntil = new Date(session.consentValidUntil);
		if (Number.isNaN(consentValidUntil.getTime())) {
			throw new EnableBankingClientError('invalid_provider_response');
		}

		let authorizedConnectionId: string | undefined;
		const authorizationLock = await this.connectionLockService.acquire(
			this.getAuthorizationLockKey(accountId, session.aspsp.name, session.aspsp.country),
			{waitForMs: AUTHORIZATION_LOCK_WAIT_MS},
		);
		let connectionLock: BankingConnectionLock | undefined;
		const assertLocksHealthy = () => {
			authorizationLock.assertHealthy();
			connectionLock?.assertHealthy();
		};

		try {
			assertLocksHealthy();
			let lockConnectionId = replacesConnectionId ?? connectionId;
			if (replacesConnectionId === null) {
				const reusableConnection = await this.bankConnectionRepository.findOne({
					where: this.getReusableConnectionWhere(accountId, session.aspsp.name, session.aspsp.country),
					order: {createdAt: 'DESC'},
				});
				lockConnectionId = reusableConnection?.id ?? connectionId;
			}
			connectionLock = await this.connectionLockService.acquire(lockConnectionId, {
				waitForMs: AUTHORIZATION_LOCK_WAIT_MS,
			});
			assertLocksHealthy();

			await this.dataSource.transaction(async (manager) => {
				assertLocksHealthy();
				const connectionRepository = manager.getRepository(BankConnection);

				const pendingConnection = await connectionRepository.findOne({
					where: {
						id: connectionId,
						status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
						authorizationStateHash,
						account: {id: accountId},
					},
					lock: {mode: 'pessimistic_write'},
				});
				if (!pendingConnection) {
					throw new BankingAuthorizationStateError('state_superseded');
				}

				if (replacesConnectionId === undefined) {
					throw new BankingAuthorizationStateError('state_superseded');
				}

				// Re-authorizing an ASPSP refreshes the existing connection instead of
				// creating a parallel one with duplicated bank accounts and transactions.
				const reusableConnection = await connectionRepository.findOne({
					where: this.getReusableConnectionWhere(
						accountId,
						pendingConnection.aspspName,
						pendingConnection.aspspCountry,
						replacesConnectionId === null ? undefined : replacesConnectionId,
					),
					lock: {mode: 'pessimistic_write'},
					...(replacesConnectionId === null ? {order: {createdAt: 'DESC'}} : {}),
				});
				if (replacesConnectionId !== null && !reusableConnection) {
					throw new BankingAuthorizationStateError('state_superseded');
				}
				const targetConnection = reusableConnection ?? pendingConnection;
				authorizedConnectionId = targetConnection.id;

				await connectionRepository.update(
					{id: targetConnection.id},
					{
						providerSessionId: this.encryptionService.encrypt(session.sessionId),
						status: BANK_CONNECTION_STATUSES.AUTHORIZED,
						authorizationStateHash: null,
						aspspName: session.aspsp.name,
						aspspCountry: session.aspsp.country,
						consentValidUntil,
						lastSyncError: null,
						nextSyncAt: new Date(),
						syncStartedAt: null,
						syncStatus: BANK_SYNC_STATUSES.QUEUED,
						syncFailureCount: 0,
						syncRetryCalls: null,
					},
				);

				await this.upsertSessionAccounts(manager, targetConnection.id, session.accounts);

				if (targetConnection.id !== pendingConnection.id) {
					await connectionRepository.delete({id: pendingConnection.id});
				}
				assertLocksHealthy();
			});
			assertLocksHealthy();
		} finally {
			if (connectionLock) {
				await releaseLockSafely(connectionLock, this.logger, 'Bank authorization lock release failed');
			}
			await releaseLockSafely(authorizationLock, this.logger, 'Bank authorization scope lock release failed');
		}

		if (!authorizedConnectionId) return;
		// Account IBANs may have changed.
		await this.ownTransferService.recomputeForOwnerSafely(accountId);
		try {
			await this.bankingSyncQueueService.enqueueInitialSync(authorizedConnectionId);
		} catch (error) {
			this.logger.warn(`Initial bank synchronization enqueue failed: ${safeErrorCode(error)}`);
		}
	}

	/** Matches each session account to a stored one by provider uid, then by identification hash; creates the rest. */
	private async upsertSessionAccounts(
		manager: EntityManager,
		connectionId: BankConnection['id'],
		accounts: EnableBankingAccount[],
	): Promise<void> {
		const bankAccountRepository = manager.getRepository(BankAccount);

		for (const account of accounts) {
			if (!account.uid) continue;

			const values = this.toBankAccountValues(account);
			let bankAccount = await bankAccountRepository.findOne({
				where: {bankConnection: {id: connectionId}, providerAccountId: account.uid},
			});

			if (!bankAccount) {
				bankAccount = await bankAccountRepository.findOne({
					where: {
						bankConnection: {id: connectionId},
						identificationHash: account.identificationHash,
					},
				});
			}

			if (!bankAccount) {
				bankAccount = bankAccountRepository.create({
					bankConnection: {id: connectionId},
					...values,
				});
			} else {
				Object.assign(bankAccount, values);
			}

			await bankAccountRepository.save(bankAccount);
		}
	}

	private async updatePendingAuthorization(
		criteria: {id: string; status: string; authorizationStateHash: string},
		status: string,
	): Promise<boolean> {
		const result = await this.bankConnectionRepository.update(criteria, {status, authorizationStateHash: null});
		return result.affected !== 0;
	}

	private async expireAuthorization(state: string | undefined): Promise<void> {
		if (!state || state.length > 256) return;

		await this.bankConnectionRepository.update(
			{
				authorizationStateHash: this.hashAuthorizationState(state),
				status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
			},
			{status: BANK_CONNECTION_STATUSES.FAILED, authorizationStateHash: null},
		);
	}

	private getAuthorizationLockKey(accountId: string, aspspName: string, aspspCountry: string): string {
		return `authorization:${this.hashAuthorizationState(`${accountId}:${aspspName}:${aspspCountry}`)}`;
	}

	private hashAuthorizationState(state: string): string {
		return createHash('sha256').update(state).digest('hex');
	}

	private getReusableConnectionWhere(
		accountId: Account['id'],
		aspspName: string,
		aspspCountry: string,
		connectionId?: BankConnection['id'],
	) {
		return {
			...(connectionId !== undefined ? {id: connectionId} : {}),
			account: {id: accountId},
			provider: PROVIDER,
			aspspName,
			aspspCountry,
			status: In(DESTRUCTIVE_CONNECTION_STATUSES),
		};
	}

	private toBankAccountValues(account: EnableBankingAccount) {
		return {
			providerAccountId: account.uid as string,
			identificationHash: account.identificationHash,
			// A session without an IBAN keeps the stored one.
			...(account.iban ? {iban: account.iban} : {}),
			name: truncate(account.name, 255),
			details: truncate(account.details, 255),
			currency: normalizeBankCode(account.currency),
			cashAccountType: truncate(account.cashAccountType, 32),
			usage: truncate(account.usage, 16),
		};
	}

	private isCancellation(error: string): boolean {
		return ['access_denied', 'cancelled', 'user_cancelled', 'user_canceled'].includes(error.toLowerCase());
	}

	private toAuthorizationStartException(error: unknown): HttpException {
		if (error instanceof BadRequestException) return error;

		if (error instanceof BankingAuthorizationStateError) {
			if (error.code === 'storage_unavailable' || error.code === 'write_failed') {
				return new ServiceUnavailableException(BANKING_SERVICE_UNAVAILABLE);
			}

			return new InternalServerErrorException(BANKING_AUTHORIZATION_START_FAILED);
		}

		if (error instanceof EnableBankingClientError) {
			return new BadGatewayException(BANKING_AUTHORIZATION_START_FAILED);
		}

		return new InternalServerErrorException(BANKING_AUTHORIZATION_START_FAILED);
	}
}
