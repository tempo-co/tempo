import {
	BadGatewayException,
	BadRequestException,
	ConflictException,
	HttpException,
	Injectable,
	InternalServerErrorException,
	Logger,
	RequestTimeoutException,
	ServiceUnavailableException,
} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {BankSyncRun as BankSyncRunResponse, BankSyncStatus} from '@tempo/contracts';
import {isIP} from 'node:net';
import {DataSource, Not, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';

import {
	BANKING_CONNECTION_NOT_AUTHORIZED,
	BANKING_CONNECTION_SESSION_UNAVAILABLE,
	BANKING_CONSENT_EXPIRED,
	BANKING_FAILED_SYNC_ERROR,
	BANKING_INTERNAL_ERROR,
	BANKING_PARTIAL_SYNC_ERROR,
	BANKING_PERSISTENCE_SYNC_ERROR,
	BANKING_RATE_LIMITED_SYNC_ERROR,
	BANKING_REFRESH_CONTEXT_UNAVAILABLE,
	BANKING_SELECTED_BANK_UNAVAILABLE,
	BANKING_SERVICE_UNAVAILABLE,
	BANKING_SUPPORTED_BANKS_UNAVAILABLE,
} from '../api/constants/banking-messages.constants';
import {BankAccountBalance} from '../bank-account-balance.entity';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {BankSyncRun} from '../bank-sync-run.entity';
import {BankTransaction} from '../bank-transaction.entity';
import {
	addDays,
	normalizeBankCode,
	safeErrorName,
	selectPreferredBalance,
	toDateOnly,
	truncate,
} from '../banking.utils';
import {BankTransactionCategorizationService} from '../categorization/bank-transaction-categorization.service';
import {
	EnableBankingBalance,
	EnableBankingPsuContext,
	EnableBankingTransaction,
	EnableBankingTransactionFetchOptions,
} from '../enable-banking.types';
import {BankingEncryptionError} from '../errors/banking-encryption.error';
import {BankingSyncCooldownError} from '../errors/banking-sync-cooldown.error';
import {FileConnectionNotSyncableException} from '../errors/file-connection-not-syncable.exception';
import {MerchantLogoService} from '../merchant-logos/merchant-logo.service';
import {BankTransactionPersistenceService, PersistTransactionsResult} from './bank-transaction-persistence.service';
import {BankingConnectionLock, BankingConnectionLockService} from './banking-connection-lock.service';
import {BankingEncryptionService} from './banking-encryption.service';
import {
	BANKING_FOREGROUND_REFRESH_MIN_INTERVAL_MS,
	BANKING_TRANSIENT_RETRY_BASE_MS,
	BANK_CONNECTION_PROVIDERS,
	BANK_CONNECTION_STATUSES,
	BANK_SYNC_STATUSES,
	resolveDurationMs,
	sanitizeRetryAfterSeconds,
} from './banking-sync.constants';
import {CurrencyExchangeService} from './currency-exchange.service';
import {EnableBankingClient, EnableBankingClientError} from './enable-banking.client';
import {findOwnedConnection} from './find-owned-connection';
import {OwnTransferService} from './own-transfer.service';

const SUCCEEDED = BANK_SYNC_STATUSES.SUCCEEDED;
const FAILED = BANK_SYNC_STATUSES.FAILED;
const PARTIAL = BANK_SYNC_STATUSES.PARTIAL;

const INCREMENTAL_OVERLAP_DAYS = 7;
const MAX_DATE_TIME_MS = 8_640_000_000_000_000;

type AccountFetchResult = {
	bankAccount: BankAccount;
	balances: EnableBankingBalance[];
	transactions: EnableBankingTransaction[];
	balancesSucceeded: boolean;
	transactionsSucceeded: boolean;
};

type SyncFetchResult = {
	accounts: AccountFetchResult[];
	knownAccounts: BankAccount[];
	authoritativeAccountIds: Set<string> | null;
	hasFailure: boolean;
	hasSuccessfulEndpoint: boolean;
	connectionExpired: boolean;
	rateLimit?: SyncRateLimit;
};

type SyncRateLimit = {
	source: 'enable-banking';
	retryAfterSeconds: number;
};

@Injectable()
export class BankingSyncService {
	private readonly logger = new Logger(BankingSyncService.name);
	private readonly bankingIntegrationEnabled: boolean;

	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		@InjectRepository(BankAccount)
		private readonly bankAccountRepository: Repository<BankAccount>,
		@InjectRepository(BankSyncRun)
		private readonly bankSyncRunRepository: Repository<BankSyncRun>,
		private readonly dataSource: DataSource,
		private readonly enableBankingClient: EnableBankingClient,
		private readonly encryptionService: BankingEncryptionService,
		private readonly connectionLockService: BankingConnectionLockService,
		private readonly categorizationService: BankTransactionCategorizationService,
		private readonly configurationService: ConfigurationService,
		private readonly ownTransferService: OwnTransferService,
		private readonly currencyExchangeService: CurrencyExchangeService,
		private readonly merchantLogoService: MerchantLogoService,
		private readonly bankTransactionPersistenceService: BankTransactionPersistenceService,
	) {
		this.bankingIntegrationEnabled = configurationService.get('BANKING_INTEGRATION_ENABLED') !== false;
	}

	async synchronizeAutomatically(connectionId: BankConnection['id']): Promise<BankSyncRunResponse | null> {
		if (!this.bankingIntegrationEnabled) return null;

		const connection = await this.bankConnectionRepository.findOne({
			where: {id: connectionId},
			relations: {account: true},
		});
		if (
			!connection ||
			connection.provider === BANK_CONNECTION_PROVIDERS.FILE ||
			connection.status !== BANK_CONNECTION_STATUSES.AUTHORIZED
		) {
			return null;
		}

		return this.runSynchronization(connection.account.id, connectionId);
	}

	/** Resolves null when the connection synchronized too recently to contact the bank again. */
	async synchronizeManually(
		accountId: Account['id'],
		connectionId: BankConnection['id'],
		psu: EnableBankingPsuContext,
		signal: AbortSignal,
	): Promise<BankSyncRunResponse | null> {
		if (!this.bankingIntegrationEnabled) throw new ServiceUnavailableException(BANKING_SERVICE_UNAVAILABLE);
		const connection = await findOwnedConnection(this.bankConnectionRepository, accountId, connectionId);
		if (connection.provider === BANK_CONNECTION_PROVIDERS.FILE) throw new FileConnectionNotSyncableException();
		return this.runSynchronization(accountId, connectionId, psu, signal);
	}

	private async runSynchronization(
		accountId: Account['id'],
		connectionId: BankConnection['id'],
		psu?: EnableBankingPsuContext,
		requestSignal?: AbortSignal,
	): Promise<BankSyncRunResponse | null> {
		const lease = await this.connectionLockService.acquire(connectionId);
		const stopRenewal = () => lease.stop();
		requestSignal?.addEventListener('abort', stopRenewal, {once: true});
		const lockLease: BankingConnectionLock = {
			...lease,
			signal: requestSignal ? AbortSignal.any([lease.signal, requestSignal]) : lease.signal,
			assertHealthy: () => {
				lease.assertHealthy();
				if (requestSignal?.aborted) throw new RequestTimeoutException(BANKING_FAILED_SYNC_ERROR);
			},
		};

		try {
			lockLease.assertHealthy();
			const connection = await findOwnedConnection(this.bankConnectionRepository, accountId, connectionId);
			if (!psu && !this.isAutomaticSyncEligible(connection)) return null;
			const providerSessionId = await this.validateConnection(connection, lockLease);
			if (psu) {
				const now = Date.now();
				if (
					connection.syncStatus === BANK_SYNC_STATUSES.RATE_LIMITED &&
					connection.nextSyncAt &&
					connection.nextSyncAt.getTime() > now
				) {
					throw new BankingSyncCooldownError(Math.ceil((connection.nextSyncAt.getTime() - now) / 1000));
				}
				if (
					connection.lastSyncedAt &&
					now - connection.lastSyncedAt.getTime() < BANKING_FOREGROUND_REFRESH_MIN_INTERVAL_MS
				) {
					return null;
				}
				psu = await this.resolveManualPsuContext(connection, psu, lockLease.signal);
			}
			let run: BankSyncRun | undefined;
			let syncStartedAt: Date | undefined;

			try {
				lockLease.assertHealthy();
				const startedAt = new Date();
				const claimResult = await this.bankConnectionRepository.update(
					{
						id: connection.id,
						status: BANK_CONNECTION_STATUSES.AUTHORIZED,
						providerSessionId: connection.providerSessionId as string,
						syncStatus: Not(BANK_SYNC_STATUSES.RUNNING),
					},
					{syncStatus: BANK_SYNC_STATUSES.RUNNING, syncStartedAt: startedAt},
				);
				if (claimResult.affected === 0) throw new Error('bank_sync_ownership_lost');
				syncStartedAt = startedAt;
				lockLease.assertHealthy();

				const bankAccounts = await this.bankAccountRepository.find({
					where: {bankConnection: {id: connection.id}},
					order: {createdAt: 'ASC'},
				});
				const previousSuccessfulRun = await this.findPreviousSuccessfulRun(connection.id);
				const requestedTo = toDateOnly(new Date()) as string;
				const requestedFrom = previousSuccessfulRun
					? addDays(previousSuccessfulRun.requestedTo ?? requestedTo, -INCREMENTAL_OVERLAP_DAYS)
					: null;
				const transactionOptions: EnableBankingTransactionFetchOptions = previousSuccessfulRun
					? {strategy: 'default', dateFrom: requestedFrom ?? undefined, dateTo: requestedTo}
					: {strategy: 'longest'};

				run = await this.bankSyncRunRepository.save(
					this.bankSyncRunRepository.create({
						bankConnection: {id: connection.id},
						status: BANK_SYNC_STATUSES.RUNNING,
						requestedFrom,
						requestedTo,
					}),
				);

				let fetchResult: SyncFetchResult;
				try {
					fetchResult = await this.fetchAccounts(
						connection.id,
						bankAccounts,
						providerSessionId,
						transactionOptions,
						lockLease,
						psu,
					);
				} catch {
					lockLease.assertHealthy();
					fetchResult = {
						accounts: [],
						knownAccounts: bankAccounts,
						authoritativeAccountIds: null,
						hasFailure: true,
						hasSuccessfulEndpoint: false,
						connectionExpired: false,
					};
				}
				lockLease.assertHealthy();

				const status = this.getRunStatus(fetchResult);
				const finishedAt = new Date();
				const persistenceResult = await this.persistSync(
					connection,
					run,
					fetchResult,
					status,
					finishedAt,
					syncStartedAt,
				);
				// Recompute first so new own transfers and exchanges are marked before the worker can claim them.
				await this.ownTransferService.recomputeForOwnerSafely(accountId);
				await this.currencyExchangeService.recomputeForOwnerSafely(accountId);
				await this.enqueuePersistedTransactions(persistenceResult.persistedTransactionIds);
				if (persistenceResult.persistedTransactionIds.length)
					await this.merchantLogoService.enqueueForOwnerSafely(accountId);
				lockLease.assertHealthy();

				const completedRun = await this.bankSyncRunRepository.findOneBy({id: run.id});
				if (!completedRun) throw new InternalServerErrorException(BANKING_PERSISTENCE_SYNC_ERROR);
				lockLease.assertHealthy();

				return this.toSyncRunResponse(completedRun, persistenceResult.transactionsAdded, fetchResult.rateLimit);
			} catch (error) {
				try {
					if (requestSignal?.aborted) {
						await this.markCancelledRefresh(connection, run?.id, syncStartedAt);
					} else {
						await this.markPersistenceFailure(connection.id, run?.id, syncStartedAt);
					}
				} catch (failureError) {
					this.logger.warn(
						`Bank synchronization failure could not be recorded: ${safeErrorName(failureError)}`,
					);
				}

				if (error instanceof HttpException) throw error;
				throw new InternalServerErrorException(BANKING_PERSISTENCE_SYNC_ERROR);
			}
		} finally {
			requestSignal?.removeEventListener('abort', stopRenewal);
			lockLease.stop();
			try {
				await lockLease.release();
			} catch {
				this.logger.warn('Bank synchronization lock release failed.');
			}
		}
	}

	private async resolveManualPsuContext(
		connection: BankConnection,
		psu: EnableBankingPsuContext,
		signal: AbortSignal,
	): Promise<EnableBankingPsuContext> {
		let aspsps;
		try {
			aspsps = await this.enableBankingClient.getAspsps(connection.aspspCountry, signal);
		} catch {
			throw new BadGatewayException(BANKING_SUPPORTED_BANKS_UNAVAILABLE);
		}
		const aspsp = aspsps.find(
			({name, country}) => name === connection.aspspName && country === connection.aspspCountry,
		);
		if (!aspsp) throw new BadRequestException(BANKING_SELECTED_BANK_UNAVAILABLE);
		const userAgent = psu.userAgent?.trim() || undefined;
		const supportedHeaders = new Map<string, string | undefined>([
			['psu-ip-address', isIP(psu.ipAddress) ? psu.ipAddress : undefined],
			['psu-user-agent', userAgent],
		]);
		if (
			!supportedHeaders.get('psu-ip-address') ||
			(aspsp.requiredPsuHeaders ?? []).some((header) => !supportedHeaders.get(header.toLowerCase()))
		) {
			throw new BadRequestException(BANKING_REFRESH_CONTEXT_UNAVAILABLE);
		}
		return {ipAddress: psu.ipAddress, userAgent};
	}

	private isAutomaticSyncEligible(
		connection: Pick<BankConnection, 'status' | 'nextSyncAt'>,
		now = new Date(),
	): boolean {
		return (
			connection.status === BANK_CONNECTION_STATUSES.AUTHORIZED &&
			connection.nextSyncAt !== null &&
			connection.nextSyncAt <= now
		);
	}

	private async validateConnection(connection: BankConnection, lockLease: BankingConnectionLock): Promise<string> {
		if (connection.status !== BANK_CONNECTION_STATUSES.AUTHORIZED) {
			throw new ConflictException(BANKING_CONNECTION_NOT_AUTHORIZED);
		}

		if (!connection.providerSessionId) {
			throw new ConflictException(BANKING_CONNECTION_SESSION_UNAVAILABLE);
		}

		let providerSessionId: string;
		try {
			providerSessionId = this.encryptionService.decrypt(connection.providerSessionId);
		} catch (error) {
			if (error instanceof BankingEncryptionError) {
				throw new ConflictException(BANKING_CONNECTION_SESSION_UNAVAILABLE);
			}
			throw new InternalServerErrorException(BANKING_INTERNAL_ERROR);
		}

		if (!connection.consentValidUntil || connection.consentValidUntil.getTime() <= Date.now()) {
			lockLease.assertHealthy();
			const result = await this.bankConnectionRepository.update(
				{
					id: connection.id,
					status: BANK_CONNECTION_STATUSES.AUTHORIZED,
					providerSessionId: connection.providerSessionId as string,
				},
				{
					status: BANK_CONNECTION_STATUSES.EXPIRED,
					lastSyncError: BANKING_CONSENT_EXPIRED,
					...this.expiredSchedulingUpdate(),
				},
			);
			if (result.affected === 0) throw new Error('bank_sync_ownership_lost');
			lockLease.assertHealthy();
			throw new ConflictException(BANKING_CONSENT_EXPIRED);
		}

		return providerSessionId;
	}

	private async findPreviousSuccessfulRun(connectionId: BankConnection['id']): Promise<BankSyncRun | null> {
		return this.bankSyncRunRepository.findOne({
			where: {bankConnection: {id: connectionId}, status: SUCCEEDED},
			order: {finishedAt: 'DESC'},
		});
	}

	private async fetchAccounts(
		connectionId: BankConnection['id'],
		bankAccounts: BankAccount[],
		providerSessionId: string,
		transactionOptions: EnableBankingTransactionFetchOptions,
		lockLease: BankingConnectionLock,
		psu?: EnableBankingPsuContext,
	): Promise<SyncFetchResult> {
		const accounts: AccountFetchResult[] = [];
		let authoritativeAccountIds: Set<string> | null = null;
		let hasFailure = false;
		let hasSuccessfulEndpoint = false;
		let connectionExpired = false;
		let rateLimit: SyncRateLimit | undefined;
		const recordFailure = (error: unknown, step: 'accounts' | 'balances' | 'transactions') => {
			lockLease.assertHealthy();
			hasFailure = true;
			// The provider's error code and HTTP status are the only details logged; responses can hold bank data.
			// The code comes from the provider's response, so only plain code characters reach the log.
			const detail =
				error instanceof EnableBankingClientError
					? `${error.code.replace(/[^\w.-]/g, '_')}${error.providerStatus ? ` (HTTP ${error.providerStatus})` : ''}`
					: safeErrorName(error);
			this.logger.warn(`Bank synchronization ${step} request failed for connection ${connectionId}: ${detail}`);
			connectionExpired ||= this.isExpiredSessionError(error);
			rateLimit = this.mergeRateLimit(rateLimit, this.toRateLimit(error));
		};

		try {
			const sessionAccounts = await this.enableBankingClient.getSessionAccounts(
				providerSessionId,
				lockLease.signal,
				...(psu ? [psu] : []),
			);
			lockLease.assertHealthy();

			if (sessionAccounts.status !== BANK_CONNECTION_STATUSES.AUTHORIZED) {
				throw new EnableBankingClientError('provider_session_not_authorized');
			}

			authoritativeAccountIds = new Set(sessionAccounts.accountIds);
			hasSuccessfulEndpoint = true;
		} catch (error) {
			recordFailure(error, 'accounts');
		}

		for (const bankAccount of bankAccounts) {
			if (connectionExpired || rateLimit) break;
			lockLease.assertHealthy();
			if (authoritativeAccountIds && !authoritativeAccountIds.has(bankAccount.providerAccountId)) continue;
			if (!authoritativeAccountIds && !bankAccount.isActive) continue;

			let balances: EnableBankingBalance[] = [];
			let transactions: EnableBankingTransaction[] = [];
			let balancesSucceeded = false;
			let transactionsSucceeded = false;

			try {
				balances = await this.enableBankingClient.getAccountBalances(
					bankAccount.providerAccountId,
					lockLease.signal,
					...(psu ? [psu] : []),
				);
				lockLease.assertHealthy();
				balancesSucceeded = true;
				hasSuccessfulEndpoint = true;
			} catch (error) {
				recordFailure(error, 'balances');
			}

			if (connectionExpired || rateLimit) break;

			try {
				transactions = await this.enableBankingClient.getAccountTransactions(
					bankAccount.providerAccountId,
					transactionOptions,
					lockLease.signal,
					...(psu ? [psu] : []),
				);
				lockLease.assertHealthy();
				transactionsSucceeded = true;
				hasSuccessfulEndpoint = true;
			} catch (error) {
				recordFailure(error, 'transactions');
			}

			accounts.push({
				bankAccount,
				balances,
				transactions,
				balancesSucceeded,
				transactionsSucceeded,
			});

			if (connectionExpired || rateLimit) break;
			lockLease.assertHealthy();
		}

		return {
			accounts,
			knownAccounts: bankAccounts,
			authoritativeAccountIds,
			hasFailure,
			hasSuccessfulEndpoint,
			connectionExpired,
			rateLimit,
		};
	}

	private getRunStatus(fetchResult: SyncFetchResult): string {
		if (!fetchResult.hasFailure) return SUCCEEDED;
		return fetchResult.hasSuccessfulEndpoint ? PARTIAL : FAILED;
	}

	private async persistSync(
		connection: BankConnection,
		run: BankSyncRun,
		fetchResult: SyncFetchResult,
		status: string,
		finishedAt: Date,
		syncStartedAt: Date,
	): Promise<Pick<PersistTransactionsResult, 'transactionsAdded' | 'persistedTransactionIds'>> {
		let errorMessage: string | null = null;
		let transactionsAdded = 0;
		const persistedTransactionIds: string[] = [];
		if (fetchResult.connectionExpired) {
			errorMessage = BANKING_CONSENT_EXPIRED;
		} else if (fetchResult.rateLimit) {
			errorMessage = BANKING_RATE_LIMITED_SYNC_ERROR;
		} else if (status === PARTIAL) {
			errorMessage = BANKING_PARTIAL_SYNC_ERROR;
		} else if (status === FAILED) {
			errorMessage = BANKING_FAILED_SYNC_ERROR;
		}

		const schedulingUpdate = this.getSchedulingUpdate(connection, fetchResult, status, finishedAt);
		await this.dataSource.transaction(async (manager) => {
			const connectionRepository = manager.getRepository(BankConnection);
			const runRepository = manager.getRepository(BankSyncRun);
			const balanceRepository = manager.getRepository(BankAccountBalance);
			const bankTransactionRepository = manager.getRepository(BankTransaction);
			const bankAccountRepository = manager.getRepository(BankAccount);
			const ownershipCriteria = {
				id: connection.id,
				syncStatus: BANK_SYNC_STATUSES.RUNNING,
				syncStartedAt,
			};
			const ownedConnection = await connectionRepository.findOne({where: ownershipCriteria});
			if (!ownedConnection) throw new Error('bank_sync_ownership_lost');
			const observedAt = new Date();

			if (fetchResult.authoritativeAccountIds) {
				for (const bankAccount of fetchResult.knownAccounts) {
					const isActive = fetchResult.authoritativeAccountIds.has(bankAccount.providerAccountId);
					if (bankAccount.isActive === isActive) continue;

					await bankAccountRepository.update({id: bankAccount.id}, {isActive});
				}
			}

			for (const accountResult of fetchResult.accounts) {
				if (accountResult.balancesSucceeded && accountResult.balances.length > 0) {
					await balanceRepository.insert(
						accountResult.balances.map((balance) =>
							this.toBalanceValues(accountResult.bankAccount, run, balance, observedAt),
						),
					);
				}

				if (accountResult.transactionsSucceeded) {
					await this.bankTransactionPersistenceService.repairIncompleteTransactionIdentities(
						bankTransactionRepository,
						accountResult.bankAccount,
					);
				}

				if (accountResult.transactionsSucceeded && accountResult.transactions.length > 0) {
					const transactionPersistence = await this.bankTransactionPersistenceService.persistTransactions(
						bankTransactionRepository,
						accountResult.bankAccount,
						accountResult.transactions,
						connection.aspspName,
						connection.provider,
					);
					transactionsAdded += transactionPersistence.transactionsAdded;
					persistedTransactionIds.push(...transactionPersistence.persistedTransactionIds);
				}

				if (accountResult.balancesSucceeded && accountResult.balances.length > 0) {
					const preferredBalance = selectPreferredBalance(accountResult.balances);
					if (preferredBalance) {
						await bankAccountRepository.update(
							{id: accountResult.bankAccount.id},
							{
								currentBalanceAmount: preferredBalance.amount,
								currentBalanceType: truncate(preferredBalance.balanceType, 32),
								balanceUpdatedAt: this.toDateTime(preferredBalance.lastChangeDateTime) ?? observedAt,
							},
						);
					}
				}
			}

			await runRepository.update(
				{id: run.id},
				{
					status,
					finishedAt,
					accountsFetched: fetchResult.accounts.filter(
						(account) => account.balancesSucceeded || account.transactionsSucceeded,
					).length,
					balancesFetched: fetchResult.accounts.reduce(
						(count, account) => count + (account.balancesSucceeded ? account.balances.length : 0),
						0,
					),
					transactionsFetched: fetchResult.accounts.reduce(
						(count, account) => count + (account.transactionsSucceeded ? account.transactions.length : 0),
						0,
					),
					errorMessage,
				},
			);

			const connectionUpdateResult = await connectionRepository.update(ownershipCriteria, {
				status: fetchResult.connectionExpired ? BANK_CONNECTION_STATUSES.EXPIRED : connection.status,
				lastSyncedAt: status === SUCCEEDED || status === PARTIAL ? finishedAt : connection.lastSyncedAt,
				lastSyncError: errorMessage,
				...schedulingUpdate,
			});
			if (connectionUpdateResult.affected === 0) throw new Error('bank_sync_ownership_lost');
		});

		return {transactionsAdded, persistedTransactionIds: [...new Set(persistedTransactionIds)]};
	}

	private expiredSchedulingUpdate(): Pick<BankConnection, 'nextSyncAt' | 'syncStartedAt' | 'syncStatus'> {
		return {
			nextSyncAt: null,
			syncStartedAt: null,
			syncStatus: BANK_SYNC_STATUSES.EXPIRED,
		};
	}

	private getSchedulingUpdate(
		connection: BankConnection,
		fetchResult: SyncFetchResult,
		status: string,
		finishedAt: Date,
	): Pick<BankConnection, 'nextSyncAt' | 'syncStartedAt' | 'syncStatus' | 'syncFailureCount'> {
		const previousFailureCount = Number.isFinite(connection.syncFailureCount) ? connection.syncFailureCount : 0;

		if (fetchResult.connectionExpired) {
			return {
				...this.expiredSchedulingUpdate(),
				syncFailureCount: previousFailureCount,
			};
		}

		if (fetchResult.rateLimit) {
			const retryAfterMs = Math.min(
				fetchResult.rateLimit.retryAfterSeconds * 1000,
				Math.max(0, MAX_DATE_TIME_MS - finishedAt.getTime()),
			);
			return {
				nextSyncAt: new Date(finishedAt.getTime() + retryAfterMs),
				syncStartedAt: null,
				syncStatus: BANK_SYNC_STATUSES.RATE_LIMITED,
				syncFailureCount: previousFailureCount,
			};
		}

		if (status === SUCCEEDED) {
			return {
				nextSyncAt: new Date(finishedAt.getTime() + this.getBackgroundIntervalMs()),
				syncStartedAt: null,
				syncStatus: BANK_SYNC_STATUSES.SUCCEEDED,
				syncFailureCount: 0,
			};
		}

		const syncFailureCount = previousFailureCount + 1;

		return {
			nextSyncAt: new Date(finishedAt.getTime() + this.getRetryDelayMs(syncFailureCount)),
			syncStartedAt: null,
			syncStatus: status === PARTIAL ? BANK_SYNC_STATUSES.PARTIAL : BANK_SYNC_STATUSES.FAILED,
			syncFailureCount,
		};
	}

	private getBackgroundIntervalMs(): number {
		return resolveDurationMs(
			this.configurationService.get('BANKING_SYNC_INTERVAL') as string,
			'BANKING_SYNC_INTERVAL',
		);
	}

	private async enqueuePersistedTransactions(transactionIds: readonly string[]): Promise<void> {
		if (transactionIds.length === 0) return;
		try {
			await this.categorizationService.enqueueForTransactions(transactionIds);
		} catch (error) {
			this.logger.warn(`Transaction categorization enqueue failed: ${safeErrorName(error)}`);
		}
	}

	private async markCancelledRefresh(
		connection: BankConnection,
		runId?: string,
		syncStartedAt?: Date,
	): Promise<void> {
		if (runId) {
			await this.bankSyncRunRepository.update(
				{id: runId, status: BANK_SYNC_STATUSES.RUNNING},
				{
					status: FAILED,
					finishedAt: new Date(),
					errorMessage: BANKING_FAILED_SYNC_ERROR,
				},
			);
		}
		if (!syncStartedAt) return;
		await this.bankConnectionRepository.update(
			{id: connection.id, syncStatus: BANK_SYNC_STATUSES.RUNNING, syncStartedAt},
			{
				syncStatus: connection.syncStatus,
				syncStartedAt: null,
				nextSyncAt: connection.nextSyncAt,
			},
		);
	}

	private async markPersistenceFailure(connectionId: string, runId?: string, syncStartedAt?: Date): Promise<void> {
		if (runId) {
			await this.bankSyncRunRepository.update(
				{id: runId, status: BANK_SYNC_STATUSES.RUNNING},
				{status: FAILED, finishedAt: new Date(), errorMessage: BANKING_PERSISTENCE_SYNC_ERROR},
			);
		}

		if (!syncStartedAt) return;

		const connectionCriteria = {
			id: connectionId,
			syncStatus: BANK_SYNC_STATUSES.RUNNING,
			syncStartedAt,
		};
		const connection = await this.bankConnectionRepository.findOne({where: connectionCriteria});
		if (!connection) return;

		const syncFailureCount = (connection.syncFailureCount ?? 0) + 1;
		await this.bankConnectionRepository.update(connectionCriteria, {
			lastSyncError: BANKING_PERSISTENCE_SYNC_ERROR,
			syncStatus: BANK_SYNC_STATUSES.FAILED,
			syncStartedAt: null,
			syncFailureCount,
			nextSyncAt: new Date(Date.now() + this.getRetryDelayMs(syncFailureCount)),
		});
	}

	private getRetryDelayMs(syncFailureCount: number): number {
		return Math.min(this.getBackgroundIntervalMs(), BANKING_TRANSIENT_RETRY_BASE_MS * 2 ** (syncFailureCount - 1));
	}

	private toBalanceValues(
		bankAccount: BankAccount,
		run: BankSyncRun,
		balance: EnableBankingBalance,
		observedAt: Date,
	) {
		return {
			bankAccountId: bankAccount.id,
			bankSyncRunId: run.id,
			name: truncate(balance.name, 255),
			balanceType: truncate(balance.balanceType, 32) ?? 'UNKNOWN',
			amount: balance.amount,
			currency: normalizeBankCode(balance.currency),
			lastChangeDateTime: this.toDateTime(balance.lastChangeDateTime),
			referenceDate: toDateOnly(balance.referenceDate),
			lastCommittedTransaction: truncate(balance.lastCommittedTransaction, 255),
			observedAt,
		};
	}

	private toSyncRunResponse(
		run: BankSyncRun,
		transactionsAdded: number,
		rateLimit?: SyncRateLimit,
	): BankSyncRunResponse {
		return {
			id: run.id,
			// Written only from BANK_SYNC_STATUSES.
			status: run.status as BankSyncStatus,
			startedAt: run.startedAt.toISOString(),
			finishedAt: run.finishedAt?.toISOString() ?? null,
			requestedFrom: run.requestedFrom,
			requestedTo: run.requestedTo,
			accountsFetched: run.accountsFetched,
			balancesFetched: run.balancesFetched,
			transactionsFetched: run.transactionsFetched,
			transactionsAdded,
			errorMessage: run.errorMessage,
			rateLimitSource: rateLimit?.source ?? null,
			retryAfterSeconds: rateLimit?.retryAfterSeconds ?? null,
		};
	}

	private toRateLimit(error: unknown): SyncRateLimit | undefined {
		if (!(error instanceof EnableBankingClientError)) return undefined;

		const normalizedCode = error.code
			.trim()
			.toUpperCase()
			.replace(/[\s-]+/g, '_');
		if (normalizedCode !== 'ASPSP_RATE_LIMIT_EXCEEDED') return undefined;

		return {
			source: 'enable-banking',
			retryAfterSeconds: sanitizeRetryAfterSeconds(error.retryAfterSeconds),
		};
	}

	private mergeRateLimit(
		current: SyncRateLimit | undefined,
		next: SyncRateLimit | undefined,
	): SyncRateLimit | undefined {
		if (!current) return next;
		if (!next || next.retryAfterSeconds <= current.retryAfterSeconds) return current;
		return next;
	}

	private toDateTime(value: string | undefined): Date | null {
		if (!value) return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}

	private isExpiredSessionError(error: unknown): boolean {
		if (!(error instanceof EnableBankingClientError)) return false;
		const code = error.code.toLowerCase();
		return (
			error.providerStatus === 401 ||
			error.providerStatus === 403 ||
			code.includes('session') ||
			code.includes('consent') ||
			code.includes('revok') ||
			code.includes('expired')
		);
	}
}
