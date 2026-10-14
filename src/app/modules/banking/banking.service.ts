import {
	BadGatewayException,
	BadRequestException,
	ConflictException,
	HttpException,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {createHash} from 'node:crypto';
import {DataSource, In, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';

import {
	BANKING_AUTHORIZATION_START_FAILED,
	BANKING_CONNECTION_NOT_FOUND,
	BANKING_CONNECTION_NOT_REMOVABLE,
	BANKING_CONNECTION_REMOVAL_CONFIRMATION_REQUIRED,
	BANKING_SELECTED_BANK_UNAVAILABLE,
	BANKING_SERVICE_UNAVAILABLE,
	BANKING_SUPPORTED_BANKS_UNAVAILABLE,
} from './api/constants/banking-messages.constants';
import {BankConnectionAuthorizeDto} from './api/dtos/bank-connection-authorize.dto';
import {BankConnectionCallbackDto} from './api/dtos/bank-connection-callback.dto';
import {
	BankAccountResponseDto,
	BankConnectionAspspResponseDto,
	BankConnectionResponseDto,
} from './api/dtos/bank-connection-response.dto';
import {BankAccountBalance} from './bank-account-balance.entity';
import {BankAccount} from './bank-account.entity';
import {BankConnectionCallbackResult} from './bank-connection-callback-result';
import {BankConnection} from './bank-connection.entity';
import {getBalancePreference, normalizeBankCode, truncate} from './banking.utils';
import {EnableBankingAccount, EnableBankingSession} from './enable-banking.types';
import {BankingAuthorizationStateError} from './errors/banking-authorization-state.error';
import {BankingEncryptionError} from './errors/banking-encryption.error';
import {convertEcbAmountSql, newestEcbRatePairSql} from './services/bank-transaction-amount-conversion.utils';
import {BankingAuthorizationStateService} from './services/banking-authorization-state.service';
import {type BankingConnectionLock, BankingConnectionLockService} from './services/banking-connection-lock.service';
import {BankingEncryptionService} from './services/banking-encryption.service';
import {BankingSyncQueueService} from './services/banking-sync-queue.service';
import {BANK_CONNECTION_STATUSES, BANK_SYNC_STATUSES} from './services/banking-sync.constants';
import {EnableBankingClient, EnableBankingClientError} from './services/enable-banking.client';
import {OwnTransferService} from './services/own-transfer.service';

const PROVIDER = 'enable-banking';

type ConvertedBalance = {amount: string; rateDate: string | null};
const AUTHORIZATION_LOCK_WAIT_MS = 10_000;
const DESTRUCTIVE_CONNECTION_STATUSES = [
	BANK_CONNECTION_STATUSES.AUTHORIZED,
	BANK_CONNECTION_STATUSES.EXPIRED,
] as const;
const REMOVABLE_CONNECTION_STATUSES = [
	BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
	BANK_CONNECTION_STATUSES.CANCELLED,
	BANK_CONNECTION_STATUSES.FAILED,
	...DESTRUCTIVE_CONNECTION_STATUSES,
] as const;

@Injectable()
export class BankingService {
	private readonly logger = new Logger(BankingService.name);

	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		@InjectRepository(BankAccount)
		private readonly bankAccountRepository: Repository<BankAccount>,
		@InjectRepository(BankAccountBalance)
		private readonly bankAccountBalanceRepository: Repository<BankAccountBalance>,
		private readonly accountService: AccountService,
		private readonly configurationService: ConfigurationService,
		private readonly dataSource: DataSource,
		private readonly enableBankingClient: EnableBankingClient,
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
		this.ensureIntegrationEnabled();
		const aspspName = dto.aspspName.trim();
		const aspspCountry = dto.aspspCountry.toUpperCase();
		const aspsps = await this.getAspsps(aspspCountry);
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

	async findSupportedAspsps(): Promise<BankConnectionAspspResponseDto[]> {
		this.ensureIntegrationEnabled();
		const aspsps = await this.getAspsps();
		const uniqueAspsps = new Map<string, BankConnectionAspspResponseDto>();

		for (const {name, country, logoUrl} of aspsps) {
			const key = `${country}:${name}`;
			const existing = uniqueAspsps.get(key);
			if (existing) {
				if (!existing.logoUrl && logoUrl) existing.logoUrl = logoUrl;
				continue;
			}

			uniqueAspsps.set(key, {name, country, ...(logoUrl ? {logoUrl} : {})});
		}

		return [...uniqueAspsps.values()].sort(
			(left, right) => left.country.localeCompare(right.country) || left.name.localeCompare(right.name),
		);
	}

	async findAll({
		id: accountId,
		baseCurrency,
	}: Pick<Account, 'id' | 'baseCurrency'>): Promise<BankConnectionResponseDto[]> {
		const connections = await this.bankConnectionRepository
			.createQueryBuilder('connection')
			.where('connection.accountId = :accountId', {accountId})
			.orderBy('connection.createdAt', 'DESC')
			.getMany();

		if (connections.length === 0) {
			return [];
		}

		const bankAccounts = await this.bankAccountRepository
			.createQueryBuilder('bankAccount')
			.innerJoin('bankAccount.bankConnection', 'bankConnection')
			.addSelect('bankConnection.id')
			.where('bankConnection.id IN (:...connectionIds)', {connectionIds: connections.map(({id}) => id)})
			.orderBy('bankAccount.createdAt', 'ASC')
			.getMany();
		const [latestBalancesByAccountId, convertedBalances] = await Promise.all([
			this.findLatestBalancesByAccountId(bankAccounts.map(({id}) => id)),
			this.convertBalances(bankAccounts, baseCurrency),
		]);
		const bankAccountsByConnectionId = new Map<string, BankAccount[]>();
		for (const bankAccount of bankAccounts) {
			const connectionAccounts = bankAccountsByConnectionId.get(bankAccount.bankConnection.id) ?? [];
			connectionAccounts.push(bankAccount);
			bankAccountsByConnectionId.set(bankAccount.bankConnection.id, connectionAccounts);
		}

		return connections.map((connection) => ({
			id: connection.id,
			provider: connection.provider,
			aspspName: connection.aspspName,
			aspspCountry: connection.aspspCountry,
			status: connection.status,
			consentValidUntil: connection.consentValidUntil,
			lastSyncedAt: connection.lastSyncedAt,
			lastSyncError: connection.lastSyncError,
			nextSyncAt: connection.nextSyncAt,
			syncStatus: connection.syncStatus,
			baseCurrency,
			bankAccounts: (bankAccountsByConnectionId.get(connection.id) ?? []).map((bankAccount) =>
				this.toBankAccountResponse(
					bankAccount,
					latestBalancesByAccountId.get(bankAccount.id) ?? [],
					convertedBalances.get(bankAccount.id),
				),
			),
		}));
	}

	async removeConnection(
		accountId: Account['id'],
		connectionId: BankConnection['id'],
		confirmation?: string,
	): Promise<void> {
		const ownedConnection = await this.bankConnectionRepository.findOne({
			where: {id: connectionId, account: {id: accountId}},
		});
		if (!ownedConnection) throw new NotFoundException(BANKING_CONNECTION_NOT_FOUND);

		const connectionLock = await this.connectionLockService.acquire(connectionId);
		let deletionCommitted = false;
		let authorizationConnectionIdsToClean = [connectionId];

		try {
			connectionLock.assertHealthy();
			await this.dataSource.transaction(async (manager) => {
				connectionLock.assertHealthy();
				const connectionRepository = manager.getRepository(BankConnection);
				const bankAccountRepository = manager.getRepository(BankAccount);
				const candidateConnection = await connectionRepository.findOne({
					where: {id: connectionId, account: {id: accountId}},
				});

				if (!candidateConnection) throw new NotFoundException(BANKING_CONNECTION_NOT_FOUND);

				// Lock pending reauthorizations before the existing connection. Callback persistence uses
				// the same order, so deletion and callback cannot deadlock or recreate the connection.
				const pendingConnections = await connectionRepository.find({
					where: {
						account: {id: accountId},
						provider: candidateConnection.provider,
						aspspName: candidateConnection.aspspName,
						aspspCountry: candidateConnection.aspspCountry,
						status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
					},
					order: {id: 'ASC'},
					lock: {mode: 'pessimistic_write'},
				});
				const connection = await connectionRepository.findOne({
					where: {id: connectionId, account: {id: accountId}},
					lock: {mode: 'pessimistic_write'},
				});

				if (!connection) throw new NotFoundException(BANKING_CONNECTION_NOT_FOUND);
				const isDestructive = DESTRUCTIVE_CONNECTION_STATUSES.includes(
					connection.status as (typeof DESTRUCTIVE_CONNECTION_STATUSES)[number],
				);
				if (
					!REMOVABLE_CONNECTION_STATUSES.includes(
						connection.status as (typeof REMOVABLE_CONNECTION_STATUSES)[number],
					)
				) {
					throw new ConflictException(BANKING_CONNECTION_NOT_REMOVABLE);
				}
				if (isDestructive && confirmation !== 'DELETE') {
					throw new BadRequestException(BANKING_CONNECTION_REMOVAL_CONFIRMATION_REQUIRED);
				}
				if (
					!isDestructive &&
					(await bankAccountRepository.count({where: {bankConnection: {id: connection.id}}})) > 0
				) {
					throw new ConflictException(BANKING_CONNECTION_NOT_REMOVABLE);
				}

				if (isDestructive) {
					const pendingConnectionIds = pendingConnections.map((pendingConnection) => pendingConnection.id);
					authorizationConnectionIdsToClean = [connectionId, ...pendingConnectionIds];
					if (pendingConnectionIds.length > 0) {
						await connectionRepository.update(
							{id: In(pendingConnectionIds), status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION},
							{status: BANK_CONNECTION_STATUSES.CANCELLED, authorizationStateHash: null},
						);
					}
				}

				await connectionRepository.remove(connection);
				connectionLock.assertHealthy();
			});
			deletionCommitted = true;
		} finally {
			if (deletionCommitted) {
				try {
					await this.authorizationStateService.removeForConnections(authorizationConnectionIdsToClean);
				} catch (error) {
					this.logger.warn(`Banking authorization cleanup failed: ${this.getSafeErrorCode(error)}`);
				}
			}

			await this.releaseLockSafely(connectionLock, 'Banking synchronization lock release failed');
		}

		// Remaining legs whose counterpart was deleted become one-sided or unlabelled.
		await this.ownTransferService.recomputeForOwnerSafely(accountId);
	}

	async handleCallback(query: BankConnectionCallbackDto): Promise<BankConnectionCallbackResult> {
		if (!this.isIntegrationEnabled()) return 'error';

		try {
			return await this.handleCallbackInternal(query);
		} catch (error) {
			this.logger.warn(`Banking authorization callback failed: ${this.getSafeErrorCode(error)}`);
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
			this.logger.warn(`Enable Banking authorization failed: ${this.getSafeErrorCode(error)}`);
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
		const authorizationLockKey = this.getAuthorizationLockKey(accountId, session.aspsp.name, session.aspsp.country);
		const authorizationLock = await this.connectionLockService.acquire(authorizationLockKey, {
			waitForMs: AUTHORIZATION_LOCK_WAIT_MS,
		});
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
			if (lockConnectionId !== authorizationLockKey) {
				connectionLock = await this.connectionLockService.acquire(lockConnectionId, {
					waitForMs: AUTHORIZATION_LOCK_WAIT_MS,
				});
			}
			assertLocksHealthy();

			await this.dataSource.transaction(async (manager) => {
				assertLocksHealthy();
				const connectionRepository = manager.getRepository(BankConnection);
				const bankAccountRepository = manager.getRepository(BankAccount);

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
					},
				);

				for (const account of session.accounts) {
					if (!account.uid) continue;

					const values = this.toBankAccountValues(account);
					let bankAccount = await bankAccountRepository.findOne({
						where: {bankConnection: {id: targetConnection.id}, providerAccountId: account.uid},
					});

					if (!bankAccount) {
						bankAccount = await bankAccountRepository.findOne({
							where: {
								bankConnection: {id: targetConnection.id},
								identificationHash: account.identificationHash,
							},
						});
					}

					if (!bankAccount) {
						bankAccount = bankAccountRepository.create({
							bankConnection: {id: targetConnection.id},
							...values,
						});
					} else {
						Object.assign(bankAccount, values);
					}

					await bankAccountRepository.save(bankAccount);
				}

				if (targetConnection.id !== pendingConnection.id) {
					await connectionRepository.delete({id: pendingConnection.id});
				}
				assertLocksHealthy();
			});
			assertLocksHealthy();
		} finally {
			if (connectionLock) {
				await this.releaseLockSafely(connectionLock, 'Bank authorization lock release failed');
			}
			await this.releaseLockSafely(authorizationLock, 'Bank authorization scope lock release failed');
		}

		if (!authorizedConnectionId) return;
		// Account IBANs may have changed.
		await this.ownTransferService.recomputeForOwnerSafely(accountId);
		try {
			await this.bankingSyncQueueService.enqueueInitialSync(authorizedConnectionId);
		} catch (error) {
			this.logger.warn(`Initial bank synchronization enqueue failed: ${this.getSafeErrorCode(error)}`);
		}
	}

	private isIntegrationEnabled(): boolean {
		return this.configurationService.get?.('BANKING_INTEGRATION_ENABLED') !== false;
	}

	private ensureIntegrationEnabled(): void {
		if (!this.isIntegrationEnabled()) throw new ServiceUnavailableException(BANKING_SERVICE_UNAVAILABLE);
	}

	private async getAspsps(country?: string) {
		try {
			return await this.enableBankingClient.getAspsps(country);
		} catch (error) {
			throw this.toProviderException(error, BANKING_SUPPORTED_BANKS_UNAVAILABLE);
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

	private async findLatestBalancesByAccountId(bankAccountIds: string[]): Promise<Map<string, BankAccountBalance[]>> {
		const latestBalancesByAccountId = new Map<string, BankAccountBalance[]>();
		if (bankAccountIds.length === 0) {
			return latestBalancesByAccountId;
		}

		const latestBalances = await this.bankAccountBalanceRepository
			.createQueryBuilder('balance')
			.distinctOn(['balance.bankAccountId', 'balance.balanceType'])
			.where('balance.bankAccountId IN (:...bankAccountIds)', {bankAccountIds})
			.orderBy('balance.bankAccountId', 'ASC')
			.addOrderBy('balance.balanceType', 'ASC')
			.addOrderBy('balance.observedAt', 'DESC')
			.addOrderBy('balance.id', 'DESC')
			.getMany();
		for (const balance of latestBalances) {
			const accountBalances = latestBalancesByAccountId.get(balance.bankAccountId) ?? [];
			accountBalances.push(balance);
			latestBalancesByAccountId.set(balance.bankAccountId, accountBalances);
		}

		return latestBalancesByAccountId;
	}

	/**
	 * Converts current balances with the newest stored ECB rates up to today, at a date both currencies were
	 * published. Approximate by design: unlike transactions, a balance has no single historical date.
	 */
	private async convertBalances(
		bankAccounts: BankAccount[],
		baseCurrency: string | null,
	): Promise<Map<string, ConvertedBalance>> {
		const converted = new Map<string, ConvertedBalance>();
		const balances = bankAccounts.filter(({currentBalanceAmount}) => currentBalanceAmount !== null);
		if (!baseCurrency || balances.length === 0) return converted;

		const rows: Array<{id: string; amount: string | null; rateDate: string | null}> = await this.dataSource.query(
			`
			SELECT input."id",
				CASE
					WHEN input."currency" = $4 THEN ROUND(input."amount", 2)
					ELSE ${convertEcbAmountSql('input."amount"', 'rate."source"', 'rate."base"')}
				END::text AS "amount",
				CASE WHEN input."currency" <> $4 THEN to_char(rate."rateDate", 'YYYY-MM-DD') END AS "rateDate"
			FROM unnest($1::uuid[], $2::varchar[], $3::numeric[]) AS input("id", "currency", "amount")
			-- CURRENT_DATE follows the session time zone; just after midnight that may pick yesterday's rate.
			LEFT JOIN LATERAL (${newestEcbRatePairSql('input."currency"', '$4::varchar', 'CURRENT_DATE')}) rate ON TRUE`,
			[
				balances.map(({id}) => id),
				balances.map(({currency}) => currency),
				balances.map(({currentBalanceAmount}) => currentBalanceAmount),
				baseCurrency,
			],
		);
		for (const {id, amount, rateDate} of rows) if (amount !== null) converted.set(id, {amount, rateDate});
		return converted;
	}

	private toBankAccountResponse(
		account: BankAccount,
		latestBalances: BankAccountBalance[],
		convertedBalance: ConvertedBalance | undefined,
	): BankAccountResponseDto {
		const primaryBalance = this.selectPreferredBalance(latestBalances);

		return {
			id: account.id,
			name: account.name,
			details: account.details,
			alias: account.alias,
			currency: account.currency,
			cashAccountType: account.cashAccountType,
			usage: account.usage,
			maskedIdentifier: account.maskedIdentifier,
			currentBalanceAmount: account.currentBalanceAmount,
			currentBalanceType: account.currentBalanceType,
			currentBalanceInBaseCurrency: convertedBalance?.amount ?? null,
			baseCurrencyRateDate: convertedBalance?.rateDate ?? null,
			balanceUpdatedAt: account.balanceUpdatedAt,
			isActive: account.isActive,
			latestBalances: latestBalances.map((balance) => ({
				name: balance.name,
				balanceType: balance.balanceType,
				amount: balance.amount,
				currency: balance.currency,
				lastChangeDateTime: balance.lastChangeDateTime,
				referenceDate: balance.referenceDate,
				observedAt: balance.observedAt,
				isPrimary: primaryBalance?.id === balance.id,
			})),
		};
	}

	private selectPreferredBalance(balances: BankAccountBalance[]): BankAccountBalance | undefined {
		return [...balances].sort((left, right) => {
			const rankDifference = getBalancePreference(right.balanceType) - getBalancePreference(left.balanceType);
			if (rankDifference !== 0) return rankDifference;
			return right.observedAt.getTime() - left.observedAt.getTime();
		})[0];
	}

	private isCancellation(error: string): boolean {
		return ['access_denied', 'cancelled', 'user_cancelled', 'user_canceled'].includes(error.toLowerCase());
	}

	private toProviderException(error: unknown, message: string): BadGatewayException {
		if (error instanceof BadGatewayException) return error;
		return new BadGatewayException(message);
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

	private async releaseLockSafely(lock: BankingConnectionLock, warning: string): Promise<void> {
		lock.stop();
		try {
			await lock.release();
		} catch (error) {
			this.logger.warn(`${warning}: ${this.getSafeErrorCode(error)}`);
		}
	}

	private getSafeErrorCode(error: unknown): string {
		if (error instanceof EnableBankingClientError) return `provider_${this.toLogSafeCode(error.code)}`;
		if (error instanceof BankingAuthorizationStateError) return `authorization_state_${error.code}`;
		if (error instanceof BankingEncryptionError) return `encryption_${error.code}`;
		return 'internal_error';
	}

	private toLogSafeCode(value: string): string {
		return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
	}
}
