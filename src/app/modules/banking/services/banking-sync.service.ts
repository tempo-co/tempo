import {
	ConflictException,
	HttpException,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {createHash, randomUUID} from 'node:crypto';
import {DataSource, In, IsNull, Not, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';

import {
	BANKING_CONNECTION_NOT_AUTHORIZED,
	BANKING_CONNECTION_NOT_FOUND,
	BANKING_CONNECTION_SESSION_UNAVAILABLE,
	BANKING_CONSENT_EXPIRED,
	BANKING_FAILED_SYNC_ERROR,
	BANKING_INTERNAL_ERROR,
	BANKING_PARTIAL_SYNC_ERROR,
	BANKING_PERSISTENCE_SYNC_ERROR,
	BANKING_RATE_LIMITED_SYNC_ERROR,
	BANKING_SERVICE_UNAVAILABLE,
} from '../api/constants/banking-messages.constants';
import {BankSyncRunResponseDto} from '../api/dtos/bank-connection-response.dto';
import {BankAccountBalance} from '../bank-account-balance.entity';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {BankSyncRun} from '../bank-sync-run.entity';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	detectBankTransactionFinancialEvent,
} from '../bank-transaction-financial-event';
import {
	allocateNextBankTransactionStableIdentityKey,
	assignBankTransactionStableIdentityKeys,
	createBankTransactionStableIdentityGroupKey,
	createBankTransactionStableIdentityKey,
	isLegacyBankTransactionDedupeKey,
} from '../bank-transaction-identity';
import {normalizeBankTransactionLocation} from '../bank-transaction-location';
import {deriveBankTransactionTextColumns} from '../bank-transaction-text-columns';
import {normalizeBankTransactionType} from '../bank-transaction-type';
import {BankTransaction} from '../bank-transaction.entity';
import {
	BATCH_WRITE_CHUNK_SIZE,
	addDays,
	buildPostgresValuesList,
	chunkArray,
	normalizeBankCode,
	safeErrorName,
	selectPreferredBalance,
	truncate,
} from '../banking.utils';
import {
	createBankTransactionCategorizationInputHash,
	toBankTransactionCategorizationInput,
} from '../categorization/bank-transaction-categorization-input';
import {BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES} from '../categorization/bank-transaction-categorization.constants';
import {BankTransactionCategorizationService} from '../categorization/bank-transaction-categorization.service';
import {
	isManualCategorySource,
	notManualCategorySourceSql,
} from '../categorization/bank-transaction-categorization.types';
import {
	EnableBankingBalance,
	EnableBankingTransaction,
	EnableBankingTransactionFetchOptions,
} from '../enable-banking.types';
import {BankingEncryptionError} from '../errors/banking-encryption.error';
import {BASE_AMOUNT_INPUT_COLUMNS, baseAmountInputsSql} from './bank-transaction-amount-conversion.utils';
import {BankingConnectionLock, BankingConnectionLockService} from './banking-connection-lock.service';
import {BankingEncryptionService} from './banking-encryption.service';
import {
	BANKING_TRANSIENT_RETRY_BASE_MS,
	BANK_CONNECTION_STATUSES,
	BANK_SYNC_STATUSES,
	resolveDurationMs,
	sanitizeRetryAfterSeconds,
} from './banking-sync.constants';
import {CurrencyExchangeService} from './currency-exchange.service';
import {EnableBankingClient, EnableBankingClientError} from './enable-banking.client';
import {OwnTransferService} from './own-transfer.service';

const SUCCEEDED = BANK_SYNC_STATUSES.SUCCEEDED;
const FAILED = BANK_SYNC_STATUSES.FAILED;
const PARTIAL = BANK_SYNC_STATUSES.PARTIAL;

const INCREMENTAL_OVERLAP_DAYS = 7;
const MAX_DATE_TIME_MS = 8_640_000_000_000_000;
const BANK_TRANSACTION_IDENTITY_SELECT: (keyof BankTransaction)[] = [
	'id',
	'bankAccountId',
	'entryReference',
	'transactionDate',
	'bookingDate',
	'valueDate',
	'amount',
	'currency',
	'creditDebitIndicator',
	'bankTransactionCode',
	'bankTransactionSubCode',
	'bankTransactionDescription',
	'description',
	'counterpartyName',
	'merchantLocation',
	'merchantCategoryCode',
	'remittanceInformation',
	'instructedAmount',
	'instructedCurrency',
	'exchangeRate',
	'exchangeRateUnitCurrency',
	'exchangeRateType',
	'referenceNumber',
	'referenceNumberScheme',
	'stableIdentityKey',
	'stableIdentityGroupKey',
	'transactionStatus',
];

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

type PersistSyncResult = {
	transactionsAdded: number;
	persistedTransactionIds: string[];
};

type LegacyDedupeKeyValues = {
	providerTransactionId: string | null;
	entryReference: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: string | null;
	description: string | null;
	counterpartyName: string | null;
	remittanceInformation: string | null;
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
	) {
		this.bankingIntegrationEnabled = configurationService.get('BANKING_INTEGRATION_ENABLED') !== false;
	}

	async synchronize(accountId: Account['id'], connectionId: BankConnection['id']): Promise<BankSyncRunResponseDto> {
		this.ensureEnabled();
		await this.findOwnedConnection(accountId, connectionId);
		const synchronizedRun = await this.runSynchronization(accountId, connectionId, {requireDue: false});
		if (!synchronizedRun) throw new InternalServerErrorException(BANKING_PERSISTENCE_SYNC_ERROR);
		return synchronizedRun;
	}

	async synchronizeAutomatically(connectionId: BankConnection['id']): Promise<BankSyncRunResponseDto | null> {
		if (!this.bankingIntegrationEnabled) return null;

		const connection = await this.bankConnectionRepository.findOne({
			where: {id: connectionId},
			relations: {account: true},
		});
		if (!connection || connection.status !== BANK_CONNECTION_STATUSES.AUTHORIZED) return null;

		return this.runSynchronization(connection.account.id, connectionId, {requireDue: true});
	}

	private async runSynchronization(
		accountId: Account['id'],
		connectionId: BankConnection['id'],
		options: {requireDue: boolean},
	): Promise<BankSyncRunResponseDto | null> {
		const lockLease = await this.connectionLockService.acquire(connectionId);

		try {
			const connection = await this.findOwnedConnection(accountId, connectionId);
			if (options.requireDue && !this.isAutomaticSyncEligible(connection)) return null;
			const providerSessionId = await this.validateConnection(connection, lockLease);
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
				const requestedTo = this.toDateOnly(new Date()) as string;
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
						bankAccounts,
						providerSessionId,
						transactionOptions,
						lockLease,
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
				await this.enqueuePersistedTransactions(persistenceResult.persistedTransactionIds);
				await this.ownTransferService.recomputeForOwnerSafely(accountId);
				await this.currencyExchangeService.recomputeForOwnerSafely(accountId);
				lockLease.assertHealthy();

				const completedRun = await this.bankSyncRunRepository.findOneBy({id: run.id});
				if (!completedRun) throw new InternalServerErrorException(BANKING_PERSISTENCE_SYNC_ERROR);
				lockLease.assertHealthy();

				return this.toSyncRunResponse(completedRun, persistenceResult.transactionsAdded, fetchResult.rateLimit);
			} catch (error) {
				try {
					await this.markPersistenceFailure(connection.id, run?.id, syncStartedAt);
				} catch (failureError) {
					this.logger.warn(
						`Automatic bank synchronization failure could not be recorded: ${safeErrorName(failureError)}`,
					);
				}

				if (error instanceof HttpException) throw error;
				throw new InternalServerErrorException(BANKING_PERSISTENCE_SYNC_ERROR);
			}
		} finally {
			lockLease.stop();
			try {
				await lockLease.release();
			} catch {
				this.logger.warn('Bank synchronization lock release failed.');
			}
		}
	}

	private ensureEnabled(): void {
		if (!this.bankingIntegrationEnabled) throw new ServiceUnavailableException(BANKING_SERVICE_UNAVAILABLE);
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

	private async findOwnedConnection(accountId: Account['id'], connectionId: BankConnection['id']) {
		const connection = await this.bankConnectionRepository.findOne({
			where: {id: connectionId, account: {id: accountId}},
		});
		if (!connection) throw new NotFoundException(BANKING_CONNECTION_NOT_FOUND);
		return connection;
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
		bankAccounts: BankAccount[],
		providerSessionId: string,
		transactionOptions: EnableBankingTransactionFetchOptions,
		lockLease: BankingConnectionLock,
	): Promise<SyncFetchResult> {
		const accounts: AccountFetchResult[] = [];
		let authoritativeAccountIds: Set<string> | null = null;
		let hasFailure = false;
		let hasSuccessfulEndpoint = false;
		let connectionExpired = false;
		let rateLimit: SyncRateLimit | undefined;
		const recordFailure = (error: unknown) => {
			lockLease.assertHealthy();
			hasFailure = true;
			connectionExpired ||= this.isExpiredSessionError(error);
			rateLimit = this.mergeRateLimit(rateLimit, this.toRateLimit(error));
		};

		try {
			const sessionAccounts = await this.enableBankingClient.getSessionAccounts(
				providerSessionId,
				lockLease.signal,
			);
			lockLease.assertHealthy();

			if (sessionAccounts.status !== BANK_CONNECTION_STATUSES.AUTHORIZED) {
				throw new EnableBankingClientError('provider_session_not_authorized');
			}

			authoritativeAccountIds = new Set(sessionAccounts.accountIds);
			hasSuccessfulEndpoint = true;
		} catch (error) {
			recordFailure(error);
		}

		if (connectionExpired || rateLimit) {
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

		for (const bankAccount of bankAccounts) {
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
				);
				lockLease.assertHealthy();
				balancesSucceeded = true;
				hasSuccessfulEndpoint = true;
			} catch (error) {
				recordFailure(error);
			}

			if (connectionExpired || rateLimit) break;

			try {
				transactions = await this.enableBankingClient.getAccountTransactions(
					bankAccount.providerAccountId,
					transactionOptions,
					lockLease.signal,
				);
				lockLease.assertHealthy();
				transactionsSucceeded = true;
				hasSuccessfulEndpoint = true;
			} catch (error) {
				recordFailure(error);
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
	): Promise<PersistSyncResult> {
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
					await this.repairIncompleteTransactionIdentities(
						bankTransactionRepository,
						accountResult.bankAccount,
					);
				}

				if (accountResult.transactionsSucceeded && accountResult.transactions.length > 0) {
					const transactionPersistence = await this.persistTransactions(
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

	private async repairIncompleteTransactionIdentities(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
	): Promise<void> {
		const incompleteTransactions = await repository.find({
			select: BANK_TRANSACTION_IDENTITY_SELECT,
			where: [
				{bankAccountId: bankAccount.id, stableIdentityKey: IsNull()},
				{bankAccountId: bankAccount.id, stableIdentityKey: ''},
				{bankAccountId: bankAccount.id, stableIdentityGroupKey: IsNull()},
				{bankAccountId: bankAccount.id, stableIdentityGroupKey: ''},
			],
			order: {id: 'ASC'},
		});
		if (incompleteTransactions.length === 0) return;

		const usedKeys = await this.getOccupiedTransactionIdentityKeys(repository, bankAccount.id);
		const identityUpdates = incompleteTransactions.map((transaction) => {
			const stableIdentityGroupKey =
				transaction.stableIdentityGroupKey || createBankTransactionStableIdentityGroupKey(transaction);
			let stableIdentityKey = transaction.stableIdentityKey;
			if (!stableIdentityKey) {
				stableIdentityKey = allocateNextBankTransactionStableIdentityKey(
					stableIdentityGroupKey,
					usedKeys,
				).stableIdentityKey;
			}
			usedKeys.add(stableIdentityKey);
			return {id: transaction.id, stableIdentityKey, stableIdentityGroupKey};
		});

		for (const chunk of chunkArray(identityUpdates, BATCH_WRITE_CHUNK_SIZE)) {
			const values = buildPostgresValuesList(
				chunk.map(({id, stableIdentityKey, stableIdentityGroupKey}) => [
					id,
					stableIdentityKey,
					stableIdentityGroupKey,
				]),
				['uuid', 'varchar', 'varchar'],
			);
			await repository.query(
				`UPDATE "bank_transactions" AS t
				SET "stableIdentityKey" = v."stableIdentityKey",
					"stableIdentityGroupKey" = v."stableIdentityGroupKey",
					"updatedAt" = CURRENT_TIMESTAMP
				FROM (VALUES ${values.sql}) AS v("id", "stableIdentityKey", "stableIdentityGroupKey")
				WHERE t."id" = v."id"`,
				values.parameters,
			);
		}
	}

	private async getOccupiedTransactionIdentityKeys(
		repository: Repository<BankTransaction>,
		bankAccountId: string,
	): Promise<Set<string>> {
		const occupiedIdentities = await repository.find({
			select: ['stableIdentityKey'],
			where: {bankAccountId, stableIdentityKey: Not(IsNull())},
		});
		return new Set(
			occupiedIdentities.flatMap(({stableIdentityKey}) => (stableIdentityKey ? [stableIdentityKey] : [])),
		);
	}

	private async persistTransactions(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		transactions: EnableBankingTransaction[],
		aspspName: string,
		provider: string,
	): Promise<PersistSyncResult> {
		const unassignedTransactionValues = transactions.map((transaction) =>
			this.toBankTransactionValues(bankAccount, transaction, aspspName, provider),
		);
		const stableIdentityGroupKeys = [
			...new Set(unassignedTransactionValues.map(({stableIdentityGroupKey}) => stableIdentityGroupKey)),
		];
		const entryReferences = [
			...new Set(
				unassignedTransactionValues.flatMap(({entryReference}) =>
					entryReference?.trim() ? [entryReference] : [],
				),
			),
		];
		const existingTransactions = await repository.find({
			select: [
				...BANK_TRANSACTION_IDENTITY_SELECT,
				'dedupeKey',
				'categoryInputHash',
				'categorySource',
				'categoryStatus',
			],
			// Include every same-reference candidate, not just pending rows: repeated references
			// and already-booked copies must make a cross-group transition ambiguous.
			where: entryReferences.length
				? [
						{bankAccountId: bankAccount.id, stableIdentityGroupKey: In(stableIdentityGroupKeys)},
						{bankAccountId: bankAccount.id, entryReference: In(entryReferences)},
					]
				: {bankAccountId: bankAccount.id, stableIdentityGroupKey: In(stableIdentityGroupKeys)},
		});
		// A booked row can retain a key from its former pending group while no longer
		// matching the incoming group or reference. Reserve keys independently of matching.
		const occupiedIdentityKeys = await this.getOccupiedTransactionIdentityKeys(repository, bankAccount.id);
		const transactionValues = assignBankTransactionStableIdentityKeys(
			unassignedTransactionValues,
			existingTransactions,
			occupiedIdentityKeys,
		);
		const stableIdentityKeys = transactionValues.map(({stableIdentityKey}) => stableIdentityKey);
		const existingTransactionsByIdentity = new Map(
			existingTransactions
				.filter(({stableIdentityKey}) => stableIdentityKey)
				.map((transaction) => [transaction.stableIdentityKey as string, transaction]),
		);
		for (const transactionValue of transactionValues) {
			const existingTransaction = existingTransactionsByIdentity.get(transactionValue.stableIdentityKey);
			if (!existingTransaction) {
				transactionValue.dedupeKey = randomUUID();
			} else if (existingTransaction.dedupeKey !== transactionValue.dedupeKey) {
				// UUID markers make rollback refuse rows the previous sync can no longer match by this legacy key.
				transactionValue.dedupeKey = isLegacyBankTransactionDedupeKey(existingTransaction.dedupeKey)
					? randomUUID()
					: existingTransaction.dedupeKey;
			}
		}

		const insertResult = await repository
			.createQueryBuilder()
			.insert()
			.into(BankTransaction)
			.values(transactionValues)
			.orIgnore()
			.returning('id')
			// RETURNING lists only inserted rows, so merging it back by position would hand new ids to
			// existing rows, and the upserts below would then overwrite their primary keys.
			.updateEntity(false)
			.execute();
		const transactionsAdded = Array.isArray(insertResult.raw) ? insertResult.raw.length : insertResult.raw ? 1 : 0;

		const conflictColumns = ['bankAccountId', 'stableIdentityKey'];
		const overwriteColumns = Object.keys(transactionValues[0]).filter(
			(column) => !conflictColumns.includes(column),
		);
		await repository
			.createQueryBuilder()
			.insert()
			.into(BankTransaction)
			.values(transactionValues)
			.orUpdate(overwriteColumns, conflictColumns, {
				overwriteCondition: {
					where: '"bank_transactions"."categoryStatus" IS DISTINCT FROM :processingStatus',
					parameters: {processingStatus: 'PROCESSING'},
				},
			})
			// Rows skipped by the condition are missing from RETURNING; keep the values unmodified.
			.updateEntity(false)
			.execute();

		const eventTransactionValues = transactionValues.filter(
			({financialEventType}) => financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		);
		if (eventTransactionValues.length > 0) {
			await repository.upsert(eventTransactionValues, conflictColumns);
		}
		await this.clearStaleBaseAmounts(repository, existingTransactions);
		await this.copySameCurrencyBaseAmounts(repository, bankAccount.id);

		const eventStableIdentityKeys = [
			...new Set(eventTransactionValues.map(({stableIdentityKey}) => stableIdentityKey)),
		];
		if (eventStableIdentityKeys.length > 0) {
			await repository
				.createQueryBuilder()
				.update(BankTransaction)
				.set({
					...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
					categoryInputHash: null,
					categoryStatus: 'NOT_APPLICABLE',
					categoryUpdatedAt: null,
				})
				.where('"bankAccountId" = :bankAccountId', {bankAccountId: bankAccount.id})
				.andWhere('"stableIdentityKey" IN (:...eventStableIdentityKeys)', {eventStableIdentityKeys})
				.andWhere('"financialEventType" = :financialEventType', {
					financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
				})
				.andWhere('"categorySource" IS DISTINCT FROM \'MANUAL\'')
				.execute();
		}

		const transactionByStableIdentityKey = new Map(
			transactionValues.map((value) => [value.stableIdentityKey, value]),
		);
		const staleCategorizationIds: string[] = [];
		for (const existingTransaction of existingTransactions) {
			if (!existingTransaction.stableIdentityKey) continue;
			const currentValue = transactionByStableIdentityKey.get(existingTransaction.stableIdentityKey);
			if (
				!currentValue ||
				currentValue.financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE ||
				isManualCategorySource(existingTransaction.categorySource) ||
				existingTransaction.categoryStatus === 'COMPLETED' ||
				existingTransaction.categoryInputHash === currentValue.categoryInputHash
			) {
				continue;
			}
			staleCategorizationIds.push(existingTransaction.id);
		}

		for (const ids of chunkArray(staleCategorizationIds, BATCH_WRITE_CHUNK_SIZE)) {
			// The guards are evaluated per row, so one statement matches the former per-row updates exactly.
			await repository
				.createQueryBuilder()
				.update(BankTransaction)
				.set({
					...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
					categoryStatus: 'PENDING',
					categoryUpdatedAt: null,
				})
				.where('id IN (:...ids)', {ids})
				.andWhere(notManualCategorySourceSql())
				.andWhere('categoryStatus IS DISTINCT FROM :completedCategoryStatus', {
					completedCategoryStatus: 'COMPLETED',
				})
				.andWhere('"categoryStatus" IS DISTINCT FROM \'PROCESSING\'')
				.andWhere('"financialEventType" IS NULL')
				.execute();
		}

		const persistedRows = await repository.find({
			select: ['id'],
			where: {bankAccountId: bankAccount.id, stableIdentityKey: In(stableIdentityKeys)},
		});
		const persistedTransactionIds =
			persistedRows.length > 0
				? persistedRows.map(({id}) => id)
				: this.getInsertedTransactionIds(insertResult.raw);

		return {transactionsAdded, persistedTransactionIds};
	}

	/**
	 * Stores amounts already in the owner's base currency right away, so they never wait for the conversion job
	 * and count in totals as soon as they are synced. Matches the job's `SAME` method; other currencies still wait
	 * for rates. Owners without a base currency yet (before their first conversion run) are left to the job.
	 */
	private async copySameCurrencyBaseAmounts(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
	): Promise<void> {
		await repository.query(
			`UPDATE "bank_transactions" AS t
			SET "amountInBaseCurrency" = ROUND(t."amount", 2), "baseAmountMethod" = 'SAME',
				"baseAmountRateDate" = NULL, "updatedAt" = CURRENT_TIMESTAMP
			FROM "bank_accounts" bank_account
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			INNER JOIN "accounts" account ON account."id" = connection."accountId"
			WHERE bank_account."id" = $1
				AND t."bankAccountId" = bank_account."id"
				AND t."baseAmountMethod" IS NULL
				AND t."currency" = account."baseCurrency"`,
			[bankAccountId],
		);
	}

	/**
	 * Clears base-currency amounts whose conversion inputs the upsert just changed, so the conversion job
	 * recomputes them. Compares the pre-sync snapshot with the stored row, so rows the upsert skipped keep theirs.
	 */
	private async clearStaleBaseAmounts(
		repository: Repository<BankTransaction>,
		previousTransactions: readonly BankTransaction[],
	): Promise<void> {
		const rows = previousTransactions.map((transaction) => [
			transaction.id,
			...BASE_AMOUNT_INPUT_COLUMNS.map(([column]) => transaction[column]),
		]);
		const casts = ['uuid', ...BASE_AMOUNT_INPUT_COLUMNS.map(([, cast]) => cast)];
		const columns = ['id', ...BASE_AMOUNT_INPUT_COLUMNS.map(([column]) => column)].map((column) => `"${column}"`);
		for (const chunk of chunkArray(rows, BATCH_WRITE_CHUNK_SIZE)) {
			const values = buildPostgresValuesList(chunk, casts);
			await repository.query(
				`UPDATE "bank_transactions" AS t
				SET "amountInBaseCurrency" = NULL, "baseAmountMethod" = NULL, "baseAmountRateDate" = NULL
				FROM (VALUES ${values.sql}) AS previous(${columns.join(', ')})
				WHERE t."id" = previous."id"
					AND t."amountInBaseCurrency" IS NOT NULL
					AND ${baseAmountInputsSql('t')} IS DISTINCT FROM ${baseAmountInputsSql('previous')}`,
				values.parameters,
			);
		}
	}

	private async enqueuePersistedTransactions(transactionIds: readonly string[]): Promise<void> {
		if (transactionIds.length === 0) return;
		try {
			await this.categorizationService.enqueueForTransactions(transactionIds);
		} catch (error) {
			this.logger.warn(`Transaction categorization enqueue failed: ${safeErrorName(error)}`);
		}
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
			referenceDate: this.toDateOnly(balance.referenceDate),
			lastCommittedTransaction: truncate(balance.lastCommittedTransaction, 255),
			observedAt,
		};
	}

	private toBankTransactionValues(
		bankAccount: BankAccount,
		transaction: EnableBankingTransaction,
		aspspName: string,
		provider: string,
	) {
		const creditDebitIndicator = truncate(normalizeBankCode(transaction.creditDebitIndicator ?? ''), 8);
		const amount = this.toSignedAmount(transaction.amount, creditDebitIndicator);
		const currency = normalizeBankCode(transaction.currency);
		const description = truncate(transaction.description, 500);
		const counterpartyName = truncate(transaction.counterpartyName, 255);
		const counterpartyIban = transaction.counterpartyIban ?? null;
		const {displayDescription, merchantKey} = deriveBankTransactionTextColumns({
			description,
			counterpartyName,
			creditDebitIndicator,
		});
		const remittanceInformation = truncate(transaction.remittanceInformation, 10_000);
		const transactionDate = this.toDateOnly(transaction.transactionDate);
		const bookingDate = this.toDateOnly(transaction.bookingDate);
		const valueDate = this.toDateOnly(transaction.valueDate);
		const providerTransactionId = truncate(transaction.providerTransactionId, 255);
		const entryReference = truncate(transaction.entryReference, 255);
		const bankTransactionCode = truncate(transaction.bankTransactionCode, 64);
		const bankTransactionSubCode = truncate(transaction.bankTransactionSubCode, 64);
		const bankTransactionDescription = truncate(transaction.bankTransactionDescription, 255);
		const merchantLocation = normalizeBankTransactionLocation(transaction.counterpartyLocation);
		const transactionType = normalizeBankTransactionType({
			code: bankTransactionCode ?? undefined,
			subCode: bankTransactionSubCode ?? undefined,
			aspspName,
		});
		const financialEvent = detectBankTransactionFinancialEvent({
			provider,
			aspspName,
			accountCurrency: bankAccount.currency,
			transactionCurrency: currency,
			creditDebitIndicator,
			description,
		});
		const merchantCategoryCode = truncate(transaction.merchantCategoryCode, 16);
		const hasBalanceAfter = Boolean(transaction.balanceAfterAmount && transaction.balanceAfterCurrency);
		const hasInstructedAmount = Boolean(transaction.instructedAmount && transaction.instructedCurrency);
		const hasExchangeRate = Boolean(transaction.exchangeRate && transaction.exchangeRateUnitCurrency);
		const instructedAmount = hasInstructedAmount ? (transaction.instructedAmount ?? null) : null;
		const instructedCurrency = hasInstructedAmount ? normalizeBankCode(transaction.instructedCurrency!) : null;
		const exchangeRate = hasExchangeRate ? (transaction.exchangeRate ?? null) : null;
		const exchangeRateUnitCurrency = hasExchangeRate
			? normalizeBankCode(transaction.exchangeRateUnitCurrency!)
			: null;
		const exchangeRateType = truncate(transaction.exchangeRateType, 16);
		const referenceNumber = truncate(transaction.referenceNumber, 255);
		const referenceNumberScheme = truncate(transaction.referenceNumberScheme, 32);
		const identityValues = {
			bankAccountId: bankAccount.id,
			entryReference,
			transactionDate,
			bookingDate,
			valueDate,
			amount,
			currency,
			creditDebitIndicator,
			bankTransactionCode,
			bankTransactionSubCode,
			bankTransactionDescription,
			description,
			counterpartyName,
			merchantLocation,
			merchantCategoryCode,
			remittanceInformation,
			instructedAmount,
			instructedCurrency,
			exchangeRate,
			exchangeRateUnitCurrency,
			exchangeRateType,
			referenceNumber,
			referenceNumberScheme,
		};
		const stableIdentityGroupKey = createBankTransactionStableIdentityGroupKey(identityValues);
		const stableIdentityKey = createBankTransactionStableIdentityKey(identityValues, 1);
		const dedupeKey = this.createLegacyDedupeKey({
			providerTransactionId,
			entryReference,
			bookingDate,
			valueDate,
			amount,
			currency,
			creditDebitIndicator,
			description,
			counterpartyName,
			remittanceInformation,
		});
		const categoryInputHash = financialEvent
			? null
			: createBankTransactionCategorizationInputHash(
					toBankTransactionCategorizationInput({
						id: stableIdentityKey,
						transactionDate,
						bookingDate,
						valueDate,
						amount,
						currency,
						creditDebitIndicator,
						bankTransactionCode,
						bankTransactionSubCode,
						aspspName,
						description,
						counterpartyName,
						bankTransactionDescription,
						merchantCategoryCode,
						remittanceInformation,
						merchantLocation,
					}),
				);

		return {
			bankAccountId: bankAccount.id,
			providerTransactionId,
			entryReference,
			dedupeKey,
			stableIdentityKey,
			stableIdentityGroupKey,
			transactionDate,
			bookingDate,
			valueDate,
			amount,
			currency,
			creditDebitIndicator,
			transactionType,
			transactionStatus: truncate(transaction.status, 32),
			bankTransactionCode,
			bankTransactionSubCode,
			bankTransactionDescription,
			description,
			displayDescription,
			merchantKey,
			counterpartyName,
			counterpartyIban,
			merchantCategoryCode,
			remittanceInformation,
			merchantLocation,
			categoryInputHash,
			financialEventType: financialEvent?.type ?? null,
			financialEventSource: financialEvent?.source ?? null,
			financialEventRuleVersion: financialEvent?.ruleVersion ?? null,
			balanceAfterAmount: hasBalanceAfter ? transaction.balanceAfterAmount : null,
			balanceAfterCurrency: hasBalanceAfter ? normalizeBankCode(transaction.balanceAfterCurrency!) : null,
			instructedAmount,
			instructedCurrency,
			exchangeRate,
			exchangeRateUnitCurrency,
			exchangeRateType,
			referenceNumber,
			referenceNumberScheme,
		};
	}

	private getInsertedTransactionIds(raw: unknown): string[] {
		const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
		return rows.flatMap((row) => {
			if (!row || typeof row !== 'object') return [];
			const id = (row as {id?: unknown}).id;
			return typeof id === 'string' ? [id] : [];
		});
	}

	private toSyncRunResponse(
		run: BankSyncRun,
		transactionsAdded: number,
		rateLimit?: SyncRateLimit,
	): BankSyncRunResponseDto {
		return {
			id: run.id,
			status: run.status,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
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

	private createLegacyDedupeKey(values: LegacyDedupeKeyValues): string {
		const fallbackValues: Record<string, string | null> = {
			providerTransactionId: values.providerTransactionId,
			entryReference: values.entryReference,
			bookingDate: values.bookingDate,
			valueDate: values.valueDate,
			amount: values.amount,
			currency: values.currency,
			creditDebitIndicator: values.creditDebitIndicator,
			description: values.description,
			counterpartyName: values.counterpartyName,
			remittanceInformation: values.remittanceInformation,
		};
		const identity = values.providerTransactionId
			? `transaction:${values.providerTransactionId}`
			: values.entryReference
				? `entry:${values.entryReference}`
				: Object.entries(fallbackValues)
						.map(([key, value]) => `${key}:${value?.trim().toLowerCase() ?? ''}`)
						.join('|');

		return createHash('sha256').update(identity).digest('hex');
	}

	private toSignedAmount(amount: string, creditDebitIndicator: string | null): string {
		const normalizedAmount = amount.trim();
		const isNegative = normalizedAmount.startsWith('-');
		const unsignedAmount = normalizedAmount.replace(/^[+-]/, '');

		if (creditDebitIndicator === 'DBIT' && !isNegative) return `-${unsignedAmount}`;
		if (creditDebitIndicator === 'CRDT' && isNegative) return unsignedAmount;
		return normalizedAmount;
	}

	private toDateTime(value: string | undefined): Date | null {
		if (!value) return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}

	private toDateOnly(value: Date | string | undefined): string | null {
		if (!value) return null;
		if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
			const date = new Date(`${value}T00:00:00.000Z`);
			return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
		}

		const date = value instanceof Date ? value : new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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
