import {
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
import {DataSource, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {dateInAppTimeZone} from '@core/time/app-time-zone';
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
} from '../api/constants/banking-messages.constants';
import {BankAccountBalance} from '../bank-account-balance.entity';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {
	BankSyncFailure,
	BankSyncRetryCall,
	INTERRUPTED_SYNC_CODE,
	UNPARSEABLE_TRANSACTIONS_CODE,
	classifyProviderFailure,
	describeBankSyncFailures,
	safeErrorStack,
	toBankSyncFailure,
} from '../bank-sync-failure';
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
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import {
	EnableBankingBalance,
	EnableBankingPsuContext,
	EnableBankingTransaction,
	EnableBankingTransactionFetchOptions,
} from '../enable-banking.types';
import {BankingEncryptionError} from '../errors/banking-encryption.error';
import {BankingSyncCooldownError} from '../errors/banking-sync-cooldown.error';
import {BankingSyncOwnershipLostError} from '../errors/banking-sync-ownership-lost.error';
import {FileConnectionNotSyncableException} from '../errors/file-connection-not-syncable.exception';
import {MerchantLogoService} from '../merchant-logos/merchant-logo.service';
import {AspspCatalogService} from './aspsp-catalog.service';
import {BankTransactionPersistenceService, PersistTransactionsResult} from './bank-transaction-persistence.service';
import {BankingConnectionLock, BankingConnectionLockService} from './banking-connection-lock.service';
import {BankingEncryptionService} from './banking-encryption.service';
import {
	BANKING_FOREGROUND_REFRESH_MIN_INTERVAL_MS,
	BANKING_TRANSIENT_RETRY_BASE_MS,
	BANKING_UNATTENDED_HISTORY_DAYS,
	BANK_CONNECTION_PROVIDERS,
	BANK_CONNECTION_STATUSES,
	BANK_SYNC_STATUSES,
	rateLimitCooldownSeconds,
	resolveDurationMs,
} from './banking-sync.constants';
import {CurrencyExchangeService} from './currency-exchange.service';
import {EnableBankingClient, EnableBankingClientError} from './enable-banking.client';
import {findOwnedConnection} from './find-owned-connection';
import {OwnTransferService} from './own-transfer.service';

const SUCCEEDED = BANK_SYNC_STATUSES.SUCCEEDED;
const FAILED = BANK_SYNC_STATUSES.FAILED;
const PARTIAL = BANK_SYNC_STATUSES.PARTIAL;

const INCREMENTAL_OVERLAP_DAYS = 7;

type AccountFetchResult = {
	bankAccount: BankAccount;
	balances: EnableBankingBalance[];
	/** Every fetched row; after a failed later page, the rows of the pages before it. */
	transactions: EnableBankingTransaction[];
	balancesSucceeded: boolean;
	/** Every transaction page was fetched, so the account's watermark may advance. */
	transactionsSucceeded: boolean;
	/** Every page was fetched and every row read, so pending rows the fetch did not return are gone. */
	transactionsComplete: boolean;
	/** The first date the transactions call asked for; null when it asked for the whole history. */
	transactionsFrom: string | null;
};

type SyncFetchResult = {
	accounts: AccountFetchResult[];
	knownAccounts: BankAccount[];
	authoritativeAccountIds: Set<string> | null;
	hasFailure: boolean;
	hasSuccessfulEndpoint: boolean;
	connectionExpired: boolean;
	rateLimit?: SyncRateLimit;
	failures: BankSyncFailure[];
	/** The date a complete transactions fetch covers, in the app's time zone. */
	fetchedThrough: string;
	/** The run repeated only the calls a previous run failed. */
	targeted: boolean;
	/** Provider calls that failed on their own and a targeted retry can repeat. */
	retryCalls: BankSyncRetryCall[];
	/** Something failed that only a full sync can retry, such as Tempo's credentials or an unexpected exception. */
	fullRetry: boolean;
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
		private readonly categorizationService: CategorizationScheduler,
		private readonly configurationService: ConfigurationService,
		private readonly ownTransferService: OwnTransferService,
		private readonly currencyExchangeService: CurrencyExchangeService,
		private readonly merchantLogoService: MerchantLogoService,
		private readonly bankTransactionPersistenceService: BankTransactionPersistenceService,
		private readonly aspspCatalogService: AspspCatalogService,
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
			const failures: BankSyncFailure[] = [];
			let committed = false;

			try {
				lockLease.assertHealthy();
				const startedAt = new Date();
				// The lease makes this run the only one: a RUNNING row left by a crashed process is taken over, and the
				// new syncStartedAt fences out anything that process might still write.
				const claimResult = await this.bankConnectionRepository.update(
					{
						id: connection.id,
						status: BANK_CONNECTION_STATUSES.AUTHORIZED,
						providerSessionId: connection.providerSessionId as string,
					},
					{syncStatus: BANK_SYNC_STATUSES.RUNNING, syncStartedAt: startedAt},
				);
				if (claimResult.affected === 0) throw new BankingSyncOwnershipLostError();
				syncStartedAt = startedAt;
				await this.finishInterruptedRuns(connection.id, startedAt);
				lockLease.assertHealthy();

				const bankAccounts = await this.bankAccountRepository.find({
					where: {bankConnection: {id: connection.id}},
					order: {createdAt: 'ASC'},
				});
				const requestedTo = dateInAppTimeZone(new Date());
				// A foreground refresh is always full; an automatic one repeats only what the last run failed, if anything.
				const retryCalls = psu ? null : connection.syncRetryCalls;
				const pendingStarts = await this.bankTransactionPersistenceService.findPendingTransactionStarts(
					this.dataSource.getRepository(BankTransaction),
					bankAccounts.map(({id}) => id),
				);
				const requestedFrom = this.getRequestedFrom(bankAccounts, retryCalls, requestedTo, pendingStarts);

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
						requestedTo,
						pendingStarts,
						retryCalls,
						lockLease,
						failures,
						psu,
					);
				} catch (error) {
					lockLease.assertHealthy();
					this.logger.warn(
						`Bank synchronization run ${run.id} failed unexpectedly: ${safeErrorStack(error)}`,
					);
					failures.push(toBankSyncFailure(error, 'internal'));
					fetchResult = {
						accounts: [],
						knownAccounts: bankAccounts,
						authoritativeAccountIds: null,
						hasFailure: true,
						hasSuccessfulEndpoint: false,
						connectionExpired: false,
						failures,
						fetchedThrough: requestedTo,
						targeted: retryCalls !== null,
						retryCalls: [],
						fullRetry: true,
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
				committed = true;
				this.logFailures(run.id, connection.id, status, failures);
				// Recompute first so new exchanges and own transfers are marked before the worker can claim them.
				// Exchanges go first: own-transfer detection skips exchange legs.
				await this.currencyExchangeService.recomputeForOwnerSafely(accountId);
				await this.ownTransferService.recomputeForOwnerSafely(accountId);
				await this.enqueuePersistedTransactions(persistenceResult.persistedTransactionIds);
				if (persistenceResult.persistedTransactionIds.length)
					await this.merchantLogoService.enqueueForOwnerSafely(accountId);

				// The run is committed: a lease blip or a disconnect from here on must not report it as failed.
				const completedRun = await this.bankSyncRunRepository.findOneBy({id: run.id});
				if (!completedRun) throw new InternalServerErrorException(BANKING_PERSISTENCE_SYNC_ERROR);

				return this.toSyncRunResponse(completedRun, persistenceResult.transactionsAdded, fetchResult.rateLimit);
			} catch (error) {
				const cancelled = requestSignal?.aborted === true;
				if (committed) {
					// The finished run already holds its outcome; only the response failed.
					this.logger.warn(
						`Bank synchronization run ${run?.id} could not be reported: ${safeErrorStack(error)}`,
					);
				} else if (cancelled) {
					failures.push({
						kind: 'cancelled',
						bankAccountId: null,
						code: 'request_aborted',
						httpStatus: null,
						retryAfter: false,
					});
				} else {
					if (!(error instanceof HttpException)) {
						this.logger.warn(
							`Bank synchronization${run ? ` run ${run.id}` : ''} for connection ${connection.id} could not finish: ${safeErrorStack(error)}`,
						);
					}
					failures.push(toBankSyncFailure(error, 'internal'));
				}
				if (run && !committed) this.logFailures(run.id, connection.id, FAILED, failures);
				try {
					if (cancelled) {
						await this.markCancelledRefresh(connection, failures, run?.id, syncStartedAt);
					} else {
						await this.markPersistenceFailure(connection.id, failures, run?.id, syncStartedAt);
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
		const aspsps = await this.aspspCatalogService.getAspsps(connection.aspspCountry, signal);
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
			if (result.affected === 0) throw new BankingSyncOwnershipLostError();
			lockLease.assertHealthy();
			throw new ConflictException(BANKING_CONSENT_EXPIRED);
		}

		return providerSessionId;
	}

	/**
	 * Each account's own window: its longest history until one fetch completed, then from that fetch's date minus
	 * the overlap, or from its oldest pending row when that is earlier, so a complete fetch shows which pending rows
	 * are gone. A start older than banks serve without the user present asks for the longest history from that
	 * start instead, which returns what the bank still has rather than failing the request.
	 */
	private getTransactionFetchOptions(
		bankAccount: BankAccount,
		today: string,
		pendingStart: string | undefined,
	): EnableBankingTransactionFetchOptions {
		if (!bankAccount.transactionsFetchedThrough) return {strategy: 'longest'};
		const overlapStart = addDays(bankAccount.transactionsFetchedThrough, -INCREMENTAL_OVERLAP_DAYS);
		const dateFrom = pendingStart && pendingStart < overlapStart ? pendingStart : overlapStart;
		if (dateFrom < addDays(today, -BANKING_UNATTENDED_HISTORY_DAYS)) return {strategy: 'longest', dateFrom};
		return {strategy: 'default', dateFrom};
	}

	/** The run's earliest requested date, or null when an account asks for its whole history. */
	private getRequestedFrom(
		bankAccounts: BankAccount[],
		retryCalls: BankSyncRetryCall[] | null,
		today: string,
		pendingStarts: ReadonlyMap<string, string>,
	): string | null {
		const starts = bankAccounts
			.filter(
				(bankAccount) =>
					bankAccount.isActive &&
					(!retryCalls ||
						retryCalls.some(
							(call) => call.kind === 'transactions' && call.bankAccountId === bankAccount.id,
						)),
			)
			.map(
				(bankAccount) =>
					this.getTransactionFetchOptions(bankAccount, today, pendingStarts.get(bankAccount.id)).dateFrom,
			);
		if (!starts.length || starts.includes(undefined)) return null;
		return (starts as string[]).sort()[0];
	}

	private async fetchAccounts(
		connectionId: BankConnection['id'],
		bankAccounts: BankAccount[],
		providerSessionId: string,
		today: string,
		pendingStarts: ReadonlyMap<string, string>,
		retryCalls: BankSyncRetryCall[] | null,
		lockLease: BankingConnectionLock,
		failures: BankSyncFailure[],
		psu?: EnableBankingPsuContext,
	): Promise<SyncFetchResult> {
		const accounts: AccountFetchResult[] = [];
		let authoritativeAccountIds: Set<string> | null = null;
		let hasFailure = false;
		let hasSuccessfulEndpoint = false;
		let connectionExpired = false;
		let rateLimit: SyncRateLimit | undefined;
		let applicationRefused = false;
		let fullRetry = false;
		const failedCalls: BankSyncRetryCall[] = [];
		const stopped = () => connectionExpired || rateLimit !== undefined || applicationRefused;
		// A targeted retry repeats only the calls the previous run failed; the bank counts every unattended call.
		const wanted = (kind: BankSyncRetryCall['kind'], bankAccountId: string | null) =>
			!retryCalls || retryCalls.some((call) => call.kind === kind && call.bankAccountId === bankAccountId);
		const recordFailure = (
			error: unknown,
			kind: 'session' | 'balances' | 'transactions',
			bankAccount?: BankAccount,
		) => {
			lockLease.assertHealthy();
			hasFailure = true;
			// Only the provider's error code and HTTP status are kept; responses can hold bank data.
			const failure = toBankSyncFailure(error, kind, bankAccount?.id ?? null);
			failures.push(failure);
			if (!(error instanceof EnableBankingClientError)) {
				fullRetry = true;
				this.logger.warn(
					`Bank synchronization ${kind} request failed unexpectedly for connection ${connectionId}: ${safeErrorStack(error)}`,
				);
				return;
			}
			switch (classifyProviderFailure(error)) {
				case 'session_ended':
					connectionExpired = true;
					break;
				case 'rate_limited':
					rateLimit = this.mergeRateLimit(rateLimit, {
						source: 'enable-banking',
						retryAfterSeconds: rateLimitCooldownSeconds(error.retryAfterSeconds),
					});
					break;
				case 'application_auth':
					applicationRefused = true;
					fullRetry = true;
					// Every connection's sync fails the same way until Tempo's credentials, key or clock are fixed.
					this.logger.error(
						`Enable Banking refused Tempo's application credentials during the ${kind} request for connection ${connectionId}: ${describeBankSyncFailures([failure])}`,
					);
					break;
				case 'failed':
					failedCalls.push({kind, bankAccountId: bankAccount?.id ?? null});
					break;
			}
		};

		if (wanted('session', null)) {
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
				recordFailure(error, 'session');
			}
		}

		for (const bankAccount of bankAccounts) {
			if (stopped()) break;
			lockLease.assertHealthy();
			if (authoritativeAccountIds && !authoritativeAccountIds.has(bankAccount.providerAccountId)) continue;
			if (!authoritativeAccountIds && !bankAccount.isActive) continue;
			const fetchBalances = wanted('balances', bankAccount.id);
			const fetchTransactions = wanted('transactions', bankAccount.id);
			if (!fetchBalances && !fetchTransactions) continue;

			let balances: EnableBankingBalance[] = [];
			let transactions: EnableBankingTransaction[] = [];
			let balancesSucceeded = false;
			let transactionsSucceeded = false;
			let transactionsComplete = false;
			const fetchOptions = this.getTransactionFetchOptions(bankAccount, today, pendingStarts.get(bankAccount.id));
			const recordUnparseable = (count: number) => {
				if (count <= 0) return;
				// The readable rows are still imported; the account's history is incomplete, so the run is partial.
				hasFailure = true;
				failures.push({
					kind: 'transactions',
					bankAccountId: bankAccount.id,
					code: UNPARSEABLE_TRANSACTIONS_CODE,
					httpStatus: null,
					retryAfter: false,
					droppedTransactions: count,
				});
			};

			if (fetchBalances) {
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
					recordFailure(error, 'balances', bankAccount);
				}
			}

			if (fetchTransactions && !stopped()) {
				try {
					const fetched = await this.enableBankingClient.getAccountTransactions(
						bankAccount.providerAccountId,
						fetchOptions,
						lockLease.signal,
						...(psu ? [psu] : []),
					);
					lockLease.assertHealthy();
					transactions = fetched.transactions;
					transactionsSucceeded = true;
					transactionsComplete = fetched.unparseableCount === 0;
					hasSuccessfulEndpoint = true;
					recordUnparseable(fetched.unparseableCount);
				} catch (error) {
					recordFailure(error, 'transactions', bankAccount);
					// Pages fetched before the failure are imported; the watermark stays until a fetch completes.
					const partial = error instanceof EnableBankingClientError ? error.partialTransactions : undefined;
					if (partial) {
						transactions = partial.transactions;
						if (transactions.length) hasSuccessfulEndpoint = true;
						recordUnparseable(partial.unparseableCount);
					}
				}
			}

			accounts.push({
				bankAccount,
				balances,
				transactions,
				balancesSucceeded,
				transactionsSucceeded,
				transactionsComplete,
				transactionsFrom: fetchOptions.dateFrom ?? null,
			});

			if (stopped()) break;
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
			failures,
			fetchedThrough: today,
			targeted: retryCalls !== null,
			retryCalls: failedCalls,
			fullRetry,
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
			if (!ownedConnection) throw new BankingSyncOwnershipLostError();
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

				let returnedTransactionIds: string[] = [];
				if (accountResult.transactions.length > 0) {
					const transactionPersistence = await this.bankTransactionPersistenceService.persistTransactions(
						bankTransactionRepository,
						accountResult.bankAccount,
						accountResult.transactions,
						connection.aspspName,
						connection.provider,
					);
					transactionsAdded += transactionPersistence.transactionsAdded;
					returnedTransactionIds = transactionPersistence.persistedTransactionIds;
					persistedTransactionIds.push(...returnedTransactionIds);
				}

				if (accountResult.transactionsComplete) {
					await this.bankTransactionPersistenceService.removeUnreturnedPendingTransactions(
						bankTransactionRepository,
						accountResult.bankAccount.id,
						returnedTransactionIds,
						accountResult.transactionsFrom,
					);
				}

				if (accountResult.transactionsSucceeded) {
					await bankAccountRepository.update(
						{id: accountResult.bankAccount.id},
						{transactionsFetchedThrough: fetchResult.fetchedThrough},
					);
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
						(account) =>
							account.balancesSucceeded ||
							account.transactionsSucceeded ||
							account.transactions.length > 0,
					).length,
					balancesFetched: fetchResult.accounts.reduce(
						(count, account) => count + (account.balancesSucceeded ? account.balances.length : 0),
						0,
					),
					transactionsFetched: fetchResult.accounts.reduce(
						(count, account) => count + account.transactions.length,
						0,
					),
					errorMessage,
					failures: fetchResult.failures.length ? fetchResult.failures : null,
				},
			);

			const connectionUpdateResult = await connectionRepository.update(ownershipCriteria, {
				status: fetchResult.connectionExpired ? BANK_CONNECTION_STATUSES.EXPIRED : connection.status,
				lastSyncedAt: status === SUCCEEDED || status === PARTIAL ? finishedAt : connection.lastSyncedAt,
				lastSyncError: errorMessage,
				...schedulingUpdate,
			});
			if (connectionUpdateResult.affected === 0) throw new BankingSyncOwnershipLostError();
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
	): Pick<BankConnection, 'nextSyncAt' | 'syncStartedAt' | 'syncStatus' | 'syncFailureCount' | 'syncRetryCalls'> {
		const previousFailureCount = Number.isFinite(connection.syncFailureCount) ? connection.syncFailureCount : 0;

		if (fetchResult.connectionExpired) {
			return {
				...this.expiredSchedulingUpdate(),
				syncFailureCount: previousFailureCount,
				syncRetryCalls: null,
			};
		}

		if (fetchResult.rateLimit) {
			return {
				nextSyncAt: new Date(finishedAt.getTime() + fetchResult.rateLimit.retryAfterSeconds * 1000),
				syncStartedAt: null,
				syncStatus: BANK_SYNC_STATUSES.RATE_LIMITED,
				syncFailureCount: previousFailureCount,
				syncRetryCalls: null,
			};
		}

		if (status === SUCCEEDED) {
			return {
				nextSyncAt: new Date(finishedAt.getTime() + this.getBackgroundIntervalMs()),
				syncStartedAt: null,
				syncStatus: BANK_SYNC_STATUSES.SUCCEEDED,
				syncFailureCount: 0,
				syncRetryCalls: null,
			};
		}

		const syncFailureCount = previousFailureCount + 1;
		const syncStatus = status === PARTIAL ? BANK_SYNC_STATUSES.PARTIAL : BANK_SYNC_STATUSES.FAILED;
		// A call that failed again in its own retry, or a failure no retry can fix (unreadable rows), waits for the
		// next ordinary sync instead of spending more of the bank's daily allowance.
		if (!fetchResult.fullRetry && (fetchResult.targeted || fetchResult.retryCalls.length === 0)) {
			return {
				nextSyncAt: new Date(finishedAt.getTime() + this.getBackgroundIntervalMs()),
				syncStartedAt: null,
				syncStatus,
				syncFailureCount,
				syncRetryCalls: null,
			};
		}

		return {
			nextSyncAt: new Date(finishedAt.getTime() + this.getRetryDelayMs(syncFailureCount)),
			syncStartedAt: null,
			syncStatus,
			syncFailureCount,
			syncRetryCalls: fetchResult.fullRetry ? null : fetchResult.retryCalls,
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

	private logFailures(
		runId: string,
		connectionId: string,
		status: string,
		failures: readonly BankSyncFailure[],
	): void {
		if (!failures.length) return;
		this.logger.warn(
			`Bank synchronization run ${runId} for connection ${connectionId} finished ${status}: ${describeBankSyncFailures(failures)}`,
		);
	}

	/** Fails the connection's runs still marked RUNNING: they belong to a process that stopped before finishing. */
	private async finishInterruptedRuns(connectionId: string, finishedAt: Date): Promise<void> {
		const result = await this.bankSyncRunRepository.update(
			{bankConnection: {id: connectionId}, status: BANK_SYNC_STATUSES.RUNNING},
			{
				status: FAILED,
				finishedAt,
				errorMessage: BANKING_FAILED_SYNC_ERROR,
				failures: [
					{
						kind: 'interrupted',
						bankAccountId: null,
						code: INTERRUPTED_SYNC_CODE,
						httpStatus: null,
						retryAfter: false,
					},
				],
			},
		);
		if (result.affected) {
			this.logger.warn(
				`Bank synchronization for connection ${connectionId} finished ${result.affected} interrupted run(s) as FAILED.`,
			);
		}
	}

	private async markCancelledRefresh(
		connection: BankConnection,
		failures: BankSyncFailure[],
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
					failures,
				},
			);
		}
		if (!syncStartedAt) return;
		await this.bankConnectionRepository.update(
			{id: connection.id, syncStatus: BANK_SYNC_STATUSES.RUNNING, syncStartedAt},
			{
				// A taken-over RUNNING row was an interrupted run, not a state to return to.
				syncStatus: connection.syncStatus === BANK_SYNC_STATUSES.RUNNING ? FAILED : connection.syncStatus,
				syncStartedAt: null,
				nextSyncAt: connection.nextSyncAt,
			},
		);
	}

	private async markPersistenceFailure(
		connectionId: string,
		failures: BankSyncFailure[],
		runId?: string,
		syncStartedAt?: Date,
	): Promise<void> {
		if (runId) {
			await this.bankSyncRunRepository.update(
				{id: runId, status: BANK_SYNC_STATUSES.RUNNING},
				{status: FAILED, finishedAt: new Date(), errorMessage: BANKING_PERSISTENCE_SYNC_ERROR, failures},
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
			syncRetryCalls: null,
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
}
