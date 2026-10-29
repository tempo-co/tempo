import Redis from 'ioredis';
import {createHash} from 'node:crypto';
import {Repository} from 'typeorm';

import {BANKING_SERVICE_UNAVAILABLE} from '../api/constants/banking-messages.constants';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {BankSyncRun} from '../bank-sync-run.entity';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
} from '../bank-transaction-financial-event';
import {type BankTransactionIdentityInput, assignBankTransactionStableIdentityKeys} from '../bank-transaction-identity';
import {BankTransaction} from '../bank-transaction.entity';
import {BankingConnectionLockService} from './banking-connection-lock.service';
import {BankingSyncService} from './banking-sync.service';
import {EnableBankingClientError} from './enable-banking.client';

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: Deferred<T>['resolve'];
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return {promise, resolve};
}

const BANKING_SYNC_SERVICE_DEPENDENCIES = [
	'bankConnectionRepository',
	'bankAccountRepository',
	'bankSyncRunRepository',
	'dataSource',
	'enableBankingClient',
	'encryptionService',
	'connectionLockService',
	'categorizationService',
	'configurationService',
	'ownTransferService',
	'currencyExchangeService',
	'merchantLogoService',
] as const;

const DEFAULT_DEPENDENCIES: Partial<Record<string, unknown>> = {
	ownTransferService: {recomputeForOwnerSafely: jest.fn().mockResolvedValue(undefined)},
	currencyExchangeService: {recomputeForOwnerSafely: jest.fn().mockResolvedValue(undefined)},
	merchantLogoService: {enqueueForOwnerSafely: jest.fn().mockResolvedValue(undefined)},
};

/** Builds the service with named test doubles; unspecified dependencies are empty objects. */
function createBankingSyncService(
	dependencies: Partial<Record<(typeof BANKING_SYNC_SERVICE_DEPENDENCIES)[number], unknown>> = {},
): BankingSyncService {
	return new BankingSyncService(
		...(BANKING_SYNC_SERVICE_DEPENDENCIES.map(
			(name) => dependencies[name] ?? DEFAULT_DEPENDENCIES[name] ?? {},
		) as ConstructorParameters<typeof BankingSyncService>),
	);
}

describe('BankingSyncService disabled integration', () => {
	it('skips automatic sync without touching persistence', async () => {
		const bankConnectionRepository = {findOne: jest.fn()};
		const service = createBankingSyncService({
			bankConnectionRepository,
			configurationService: {
				get: jest.fn((key: string) => (key === 'BANKING_INTEGRATION_ENABLED' ? false : '6h')),
			},
		});

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toBeNull();
		await expect(
			service.synchronizeManually(
				'account-id',
				'connection-id',
				{ipAddress: '192.0.2.42'},
				new AbortController().signal,
			),
		).rejects.toMatchObject({status: 503, message: BANKING_SERVICE_UNAVAILABLE});
		expect(bankConnectionRepository.findOne).not.toHaveBeenCalled();
	});
});

describe('BankingSyncService manual refresh context', () => {
	it.each(['', 'not-an-ip', '192.0.2.42, 192.0.2.43'])(
		'refuses missing or invalid derived IP %j before claiming a run',
		async (ipAddress) => {
			const connection = {
				id: 'connection-id',
				status: 'AUTHORIZED',
				providerSessionId: 'encrypted',
				consentValidUntil: new Date(Date.now() + 60_000),
				aspspName: 'Example Bank',
				aspspCountry: 'FI',
			};
			const bankConnectionRepository = {findOne: jest.fn().mockResolvedValue(connection), update: jest.fn()};
			const service = createBankingSyncService({
				bankConnectionRepository,
				configurationService: {get: jest.fn(() => true)},
				encryptionService: {decrypt: jest.fn(() => 'session-id')},
				connectionLockService: {
					acquire: jest.fn().mockResolvedValue({
						signal: new AbortController().signal,
						assertHealthy: jest.fn(),
						stop: jest.fn(),
						release: jest.fn().mockResolvedValue(undefined),
					}),
				},
				enableBankingClient: {
					getAspsps: jest
						.fn()
						.mockResolvedValue([
							{name: 'Example Bank', country: 'FI', maximumConsentValiditySeconds: 86_400},
						]),
				},
			});
			await expect(
				service.synchronizeManually(
					'account-id',
					connection.id,
					{ipAddress, userAgent: 'ExampleBrowser/1.0'},
					new AbortController().signal,
				),
			).rejects.toMatchObject({
				status: 400,
				message: 'Browser context required by this bank is unavailable. Please try again from your browser.',
			});
			expect(bankConnectionRepository.update).not.toHaveBeenCalled();
		},
	);
});

describe('BankingSyncService automatic sync eligibility', () => {
	it.each([
		['is not due yet', {status: 'AUTHORIZED', nextSyncAt: new Date(Date.now() + 60_000)}],
		['has no scheduled sync', {status: 'AUTHORIZED', nextSyncAt: null}],
		['is not authorized', {status: 'EXPIRED', nextSyncAt: new Date(0)}],
	])('skips a connection that %s without claiming it', async (_case, state) => {
		const connection = {id: 'connection-id', account: {id: 'account-id'}, providerSessionId: 'encrypted', ...state};
		const bankConnectionRepository = {findOne: jest.fn().mockResolvedValue(connection), update: jest.fn()};
		const lockLease = {assertHealthy: jest.fn(), stop: jest.fn(), release: jest.fn().mockResolvedValue(undefined)};
		const service = createBankingSyncService({
			bankConnectionRepository,
			connectionLockService: {acquire: jest.fn().mockResolvedValue(lockLease)},
			configurationService: {
				get: jest.fn((key: string) => (key === 'BANKING_INTEGRATION_ENABLED' ? true : '6h')),
			},
		});

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toBeNull();
		expect(bankConnectionRepository.update).not.toHaveBeenCalled();
	});
});

type LockOwner = {
	token: string;
	expiresAt: number;
};

describe('BankingSyncService synchronization lock', () => {
	let service: BankingSyncService;
	let redis: {
		set: jest.Mock;
		eval: jest.Mock;
	};
	let transactionGate: Deferred<[]>;
	let lockOwner: LockOwner | undefined;
	let renewalShouldFail: boolean;
	let enableBankingClient: {
		getSessionAccounts: jest.Mock;
		getAccountBalances: jest.Mock;
		getAccountTransactions: jest.Mock;
	};
	let bankConnectionRepository: {
		findOne: jest.Mock;
		update: jest.Mock;
	};
	let bankSyncRunRepository: {
		create: jest.Mock;
		save: jest.Mock;
		findOne: jest.Mock;
		findOneBy: jest.Mock;
		update: jest.Mock;
	};
	type TransactionRepository = {
		find: jest.Mock;
		query: jest.Mock;
		insert: jest.Mock;
		upsert: jest.Mock;
		update: jest.Mock;
		createQueryBuilder: jest.Mock;
	};
	let transactionRepository: TransactionRepository & {findOne: jest.Mock};
	let bankAccountRepository: {find: jest.Mock; update: jest.Mock};
	let configurationService: {get: jest.Mock};
	let merchantLogoService: {enqueueForOwnerSafely: jest.Mock};

	beforeEach(() => {
		jest.useFakeTimers();
		transactionGate = deferred<[]>();
		lockOwner = undefined;
		renewalShouldFail = false;
		redis = {
			set: jest.fn(async (_key: string, token: string, _expiration: string, ttl: number) => {
				if (lockOwner && lockOwner.expiresAt <= Date.now()) lockOwner = undefined;
				if (lockOwner) return null;
				lockOwner = {token, expiresAt: Date.now() + ttl * 1000};
				return 'OK';
			}),
			eval: jest.fn(async (script: string, _keyCount: number, _key: string, token: string, ttl?: number) => {
				if (script.includes('expire')) {
					if (renewalShouldFail) return 0;
					if (lockOwner?.token !== token || lockOwner.expiresAt <= Date.now()) return 0;
					lockOwner.expiresAt = Date.now() + (ttl ?? 0) * 1000;
					return 1;
				}

				if (lockOwner?.token !== token) return 0;
				lockOwner = undefined;
				return 1;
			}),
		};

		const connection = {
			id: 'connection-id',
			status: 'AUTHORIZED',
			providerSessionId: 'encrypted-session',
			consentValidUntil: new Date(Date.now() + 60 * 60 * 1000),
			nextSyncAt: new Date(Date.now() - 1),
			lastSyncedAt: null,
			lastSyncError: null,
			account: {id: 'account-id'},
		} as unknown as BankConnection;
		const bankAccount = {
			id: 'bank-account-id',
			providerAccountId: 'provider-account-id',
		} as unknown as BankAccount;
		const run = {
			id: 'run-id',
			startedAt: new Date(),
			requestedFrom: null,
			requestedTo: '2026-09-03',
			status: 'RUNNING',
		} as unknown as BankSyncRun;
		const completedRun = {
			...run,
			status: 'SUCCEEDED',
			finishedAt: new Date(),
			accountsFetched: 1,
			balancesFetched: 0,
			transactionsFetched: 0,
			errorMessage: null,
		} as unknown as BankSyncRun;

		bankConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(connection),
			update: jest.fn().mockResolvedValue({affected: 1}),
		};
		bankAccountRepository = {
			find: jest.fn().mockResolvedValue([bankAccount]),
			update: jest.fn().mockResolvedValue({affected: 1}),
		};
		bankSyncRunRepository = {
			create: jest.fn().mockReturnValue(run),
			save: jest.fn().mockResolvedValue(run),
			findOne: jest.fn().mockResolvedValue(null),
			findOneBy: jest.fn().mockResolvedValue(completedRun),
			update: jest.fn().mockResolvedValue({affected: 1}),
		};
		transactionRepository = {
			find: jest.fn().mockResolvedValue([]),
			findOne: jest.fn().mockResolvedValue(connection),
			query: jest.fn().mockResolvedValue([]),
			insert: jest.fn().mockResolvedValue(undefined),
			upsert: jest.fn().mockResolvedValue(undefined),
			update: jest.fn().mockResolvedValue({affected: 1}),
			createQueryBuilder: jest.fn(),
		};
		const dataSource = {
			transaction: jest.fn(async (callback: (manager: unknown) => Promise<void>) =>
				callback({getRepository: jest.fn().mockReturnValue(transactionRepository)}),
			),
		};
		enableBankingClient = {
			getSessionAccounts: jest
				.fn()
				.mockResolvedValue({status: 'AUTHORIZED', accountIds: ['provider-account-id']}),
			getAccountBalances: jest.fn().mockResolvedValue([]),
			getAccountTransactions: jest.fn().mockImplementation(() => transactionGate.promise),
		};
		const encryptionService = {
			decrypt: jest.fn().mockReturnValue('provider-session'),
		};
		const categorizationService = {
			enqueueForTransactions: jest.fn().mockResolvedValue(undefined),
		};
		merchantLogoService = {enqueueForOwnerSafely: jest.fn().mockResolvedValue(undefined)};

		configurationService = {get: jest.fn().mockReturnValue('6h')};
		service = createBankingSyncService({
			bankConnectionRepository,
			bankAccountRepository,
			bankSyncRunRepository,
			dataSource,
			enableBankingClient,
			encryptionService,
			connectionLockService: new BankingConnectionLockService(redis as unknown as Redis),
			categorizationService,
			configurationService,
			merchantLogoService,
		});
	});

	it('rechecks the connection after acquiring the lock', async () => {
		bankConnectionRepository.findOne
			.mockReset()
			.mockResolvedValueOnce({
				id: 'connection-id',
				status: 'AUTHORIZED',
				providerSessionId: 'encrypted-session',
				consentValidUntil: new Date(Date.now() + 60 * 60 * 1000),
				nextSyncAt: new Date(Date.now() - 1),
				account: {id: 'account-id'},
			} as BankConnection)
			.mockResolvedValueOnce(null);
		enableBankingClient.getAccountTransactions.mockResolvedValueOnce([]);

		await expect(service.synchronizeAutomatically('connection-id')).rejects.toMatchObject({status: 404});
		expect(enableBankingClient.getSessionAccounts).not.toHaveBeenCalled();
	});

	it('reports only transactions that were added during synchronization', async () => {
		const transactions = [
			{
				providerTransactionId: 'existing-transaction',
				amount: '10.00',
				currency: 'EUR',
				counterpartyLocation: {
					city: 'Exampletown',
					region: 'Example Region',
					country: 'NL',
					streetName: 'Private Street',
				},
			},
			{providerTransactionId: 'new-transaction', amount: '20.00', currency: 'EUR'},
		];
		const insertQueryBuilder = {
			insert: jest.fn().mockReturnThis(),
			into: jest.fn().mockReturnThis(),
			values: jest.fn().mockReturnThis(),
			orIgnore: jest.fn().mockReturnThis(),
			orUpdate: jest.fn().mockReturnThis(),
			returning: jest.fn().mockReturnThis(),
			updateEntity: jest.fn().mockReturnThis(),
			execute: jest.fn().mockResolvedValue({
				raw: [
					{id: 'existing-transaction-id', inserted: false},
					{id: 'new-transaction-id', inserted: true},
				],
			}),
		};
		transactionRepository.createQueryBuilder.mockReturnValue(insertQueryBuilder);
		enableBankingClient.getAccountTransactions.mockResolvedValue(transactions);
		bankSyncRunRepository.findOneBy.mockResolvedValue({
			id: 'run-id',
			status: 'SUCCEEDED',
			startedAt: new Date(),
			finishedAt: new Date(),
			requestedFrom: null,
			requestedTo: '2026-09-09',
			accountsFetched: 1,
			balancesFetched: 0,
			transactionsFetched: 2,
			errorMessage: null,
		} as unknown as BankSyncRun);

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({
			status: 'SUCCEEDED',
			transactionsFetched: 2,
			transactionsAdded: 1,
		});
		expect(insertQueryBuilder.orUpdate).toHaveBeenCalledTimes(1);
		expect(insertQueryBuilder.returning).toHaveBeenCalledWith('"id", ("xmax" = 0) AS "inserted"');
		expect(insertQueryBuilder.values).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					merchantLocation: {city: 'Exampletown', region: 'Example Region', country: 'NL'},
				}),
			]),
		);
		expect(transactionRepository.update).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'connection-id',
				syncStatus: 'RUNNING',
				syncStartedAt: expect.any(Date),
			}),
			expect.objectContaining({
				syncStatus: 'SUCCEEDED',
				syncFailureCount: 0,
				nextSyncAt: expect.any(Date),
			}),
		);
		// New rows bring their owner's new merchants to logo identification.
		expect(merchantLogoService.enqueueForOwnerSafely).toHaveBeenCalledWith('account-id');
	});

	it('persists the provider Retry-After as the next automatic synchronization gate', async () => {
		transactionGate.resolve([]);
		enableBankingClient.getAccountBalances.mockRejectedValueOnce(
			new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 429, 120),
		);
		enableBankingClient.getAccountTransactions.mockResolvedValueOnce([]);

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({
			status: 'SUCCEEDED',
		});

		const connectionUpdate = transactionRepository.update.mock.calls
			.map(([, values]) => values)
			.find((values) => values?.syncStatus === 'RATE_LIMITED');
		expect(connectionUpdate).toEqual(
			expect.objectContaining({
				syncStatus: 'RATE_LIMITED',
				nextSyncAt: expect.any(Date),
			}),
		);
		expect(connectionUpdate.nextSyncAt.getTime() - Date.now()).toBeGreaterThanOrEqual(119_000);
	});

	it('uses the six-hour fallback even when the ordinary background interval is shorter', async () => {
		configurationService.get.mockReturnValue('1h');
		transactionGate.resolve([]);
		enableBankingClient.getAccountBalances.mockRejectedValueOnce(
			new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 400),
		);
		enableBankingClient.getAccountTransactions.mockResolvedValueOnce([]);

		await service.synchronizeAutomatically('connection-id');

		const connectionUpdate = transactionRepository.update.mock.calls
			.map(([, values]) => values)
			.find((values) => values?.syncStatus === 'RATE_LIMITED');
		expect(connectionUpdate.nextSyncAt.getTime() - Date.now()).toBeGreaterThanOrEqual(21_599_000);
	});

	it('honors an explicit zero-second provider retry delay', async () => {
		transactionGate.resolve([]);
		enableBankingClient.getAccountBalances.mockRejectedValueOnce(
			new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 400, 0),
		);
		enableBankingClient.getAccountTransactions.mockResolvedValueOnce([]);

		await service.synchronizeAutomatically('connection-id');

		const connectionUpdate = transactionRepository.update.mock.calls
			.map(([, values]) => values)
			.find((values) => values?.syncStatus === 'RATE_LIMITED');
		expect(connectionUpdate.nextSyncAt.getTime() - Date.now()).toBeLessThan(1_000);
	});
	it('does not classify an unrelated HTTP 429 as an ASPSP rate limit', async () => {
		transactionGate.resolve([]);
		enableBankingClient.getAccountBalances.mockRejectedValueOnce(
			new EnableBankingClientError('provider_temporarily_unavailable', 429, 120),
		);
		enableBankingClient.getAccountTransactions.mockResolvedValueOnce([]);

		await service.synchronizeAutomatically('connection-id');

		const connectionUpdate = transactionRepository.update.mock.calls
			.map(([, values]) => values)
			.find((values) => values?.syncStatus);
		expect(connectionUpdate.syncStatus).not.toBe('RATE_LIMITED');
	});

	it('keeps a very large usable Retry-After inside the JavaScript Date range', async () => {
		transactionGate.resolve([]);
		enableBankingClient.getAccountBalances.mockRejectedValueOnce(
			new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 429, 8_000_000_000_000),
		);
		enableBankingClient.getAccountTransactions.mockResolvedValueOnce([]);

		await service.synchronizeAutomatically('connection-id');

		const connectionUpdate = transactionRepository.update.mock.calls
			.map(([, values]) => values)
			.find((values) => values?.syncStatus === 'RATE_LIMITED');
		expect(Number.isNaN(connectionUpdate.nextSyncAt.getTime())).toBe(false);
	});

	it('backs off when session validation is rate-limited', async () => {
		enableBankingClient.getSessionAccounts.mockRejectedValueOnce(
			new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 400, 23),
		);

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({
			status: 'SUCCEEDED',
			retryAfterSeconds: 23,
		});

		const connectionUpdate = transactionRepository.update.mock.calls
			.map(([, values]) => values)
			.find((values) => values?.syncStatus === 'RATE_LIMITED');
		expect(connectionUpdate).toEqual(
			expect.objectContaining({
				syncStatus: 'RATE_LIMITED',
				nextSyncAt: expect.any(Date),
			}),
		);
		expect(connectionUpdate.nextSyncAt.getTime() - Date.now()).toBeGreaterThanOrEqual(22_000);
	});

	it('records a retryable failure when loading accounts throws after RUNNING is persisted', async () => {
		bankAccountRepository.find.mockRejectedValueOnce(new Error('database read failed'));

		await expect(service.synchronizeAutomatically('connection-id')).rejects.toThrow(
			'Bank synchronization could not be saved.',
		);

		expect(bankConnectionRepository.update).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'connection-id',
				syncStatus: 'RUNNING',
				syncStartedAt: expect.any(Date),
			}),
			expect.objectContaining({
				lastSyncError: 'Bank synchronization could not be saved.',
				syncStatus: 'FAILED',
				nextSyncAt: expect.any(Date),
			}),
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('renews a long-running lock so a second synchronization cannot overlap', async () => {
		const firstSync = service.synchronizeAutomatically('connection-id');
		await jest.advanceTimersByTimeAsync(0);
		expect(redis.set).toHaveBeenCalledTimes(1);

		await jest.advanceTimersByTimeAsync(15 * 60 * 1000 + 1);
		const secondSync = service.synchronizeAutomatically('connection-id');
		const secondSyncResult = expect(secondSync).rejects.toThrow('A bank synchronization is already in progress.');
		await jest.advanceTimersByTimeAsync(0);

		transactionGate.resolve([]);

		await secondSyncResult;
		await expect(firstSync).resolves.toEqual(
			expect.objectContaining({
				id: 'run-id',
				status: 'SUCCEEDED',
			}),
		);
		expect(redis.eval.mock.calls.some(([script]) => String(script).includes('expire'))).toBe(true);
	});

	it('cancels the synchronization when renewal loses lock ownership', async () => {
		const firstSync = service.synchronizeAutomatically('connection-id');
		const firstSyncResult = expect(firstSync).rejects.toThrow(BANKING_SERVICE_UNAVAILABLE);
		await jest.advanceTimersByTimeAsync(0);

		const requestSignal = enableBankingClient.getAccountTransactions.mock.calls[0][2] as AbortSignal;
		renewalShouldFail = true;
		await jest.advanceTimersByTimeAsync((15 * 60 * 1000) / 3 + 1);

		expect(requestSignal.aborted).toBe(true);
		lockOwner = {token: 'new-owner', expiresAt: Date.now() + 15 * 60 * 1000};
		transactionGate.resolve([]);

		await firstSyncResult;
		expect(lockOwner.token).toBe('new-owner');
		const failureUpdate = bankConnectionRepository.update.mock.calls.find(
			([, values]) => values?.syncStatus === 'FAILED',
		);
		expect(failureUpdate?.[0]).toEqual(
			expect.objectContaining({syncStatus: 'RUNNING', syncStartedAt: expect.any(Date)}),
		);
	});
});

describe('BankingSyncService transaction event persistence', () => {
	function createServiceForTransactionValues(): BankingSyncService {
		return createBankingSyncService({configurationService: {get: jest.fn().mockReturnValue('6h')}});
	}

	function toBankTransactionValues(
		service: BankingSyncService,
		transaction: Record<string, unknown>,
		bankAccount: Record<string, unknown>,
		provider = 'enable-banking',
		aspspName = 'Revolut',
	): BankTransactionIdentityInput & Record<string, unknown> {
		return (
			service as unknown as {
				toBankTransactionValues: (...args: unknown[]) => BankTransactionIdentityInput & Record<string, unknown>;
			}
		).toBankTransactionValues(bankAccount, transaction, aspspName, provider);
	}

	function createLegacyFallbackDedupeKey(values: Record<string, string | null>): string {
		const identity = Object.entries(values)
			.map(([key, value]) => `${key}:${value?.trim().toLowerCase() ?? ''}`)
			.join('|');
		return createHash('sha256').update(identity).digest('hex');
	}

	it('repairs empty stable identity keys and group keys', async () => {
		const service = createServiceForTransactionValues();
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const transaction = toBankTransactionValues(
			service,
			{amount: '12.00', currency: 'EUR', bookingDate: '2026-09-01'},
			bankAccount as unknown as Record<string, unknown>,
		);
		const incompleteTransaction = {
			...transaction,
			id: 'existing-transaction-id',
			stableIdentityKey: '',
			stableIdentityGroupKey: '',
		};
		const repositoryFind = jest.fn().mockResolvedValueOnce([incompleteTransaction]).mockResolvedValueOnce([]);
		const repository = {
			find: repositoryFind,
			query: jest.fn().mockResolvedValue(undefined),
		} as unknown as Repository<BankTransaction>;

		await (
			service as unknown as {
				repairIncompleteTransactionIdentities: (...args: unknown[]) => Promise<void>;
			}
		).repairIncompleteTransactionIdentities(repository, bankAccount);

		expect(repositoryFind).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				where: expect.arrayContaining([
					{bankAccountId: bankAccount.id, stableIdentityKey: ''},
					{bankAccountId: bankAccount.id, stableIdentityGroupKey: ''},
				]),
			}),
		);
		expect(repository.query).toHaveBeenCalledTimes(1);
		const [sql, parameters] = (repository.query as jest.Mock).mock.calls[0] as [string, string[]];
		expect(sql).toContain('UPDATE "bank_transactions" AS t');
		expect(sql).toContain('FROM (VALUES ($1::uuid, $2::varchar, $3::varchar))');
		expect(sql).toContain('WHERE t."id" = v."id"');
		const [id, stableIdentityKey, stableIdentityGroupKey] = parameters;
		expect(id).toBe('existing-transaction-id');
		expect(stableIdentityKey).not.toBe('');
		expect(stableIdentityGroupKey).not.toBe('');
	});

	it('uses the stable entry reference instead of a changing provider transaction ID', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id-a',
			entryReference: 'entry-reference.test',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			counterpartyName: 'Synthetic Counterparty',
			remittanceInformation: 'Fixture reference',
		};
		const first = toBankTransactionValues(
			service,
			transaction,
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);
		const nextFetch = toBankTransactionValues(
			service,
			{...transaction, providerTransactionId: 'volatile-provider-id-b'},
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);

		expect(first.stableIdentityKey).toEqual(expect.any(String));
		expect(first.stableIdentityKey).toBe(nextFetch.stableIdentityKey);
	});

	it('reproduces the legacy fallback key from the provider amount text and fallback fields', () => {
		const service = createServiceForTransactionValues();
		const values = toBankTransactionValues(
			service,
			{
				amount: '12.00',
				currency: 'eur',
				creditDebitIndicator: 'dbit',
				bookingDate: '2026-09-01',
				valueDate: '2026-09-02',
				description: ' Synthetic test payment ',
				counterpartyName: ' Synthetic Counterparty ',
				remittanceInformation: ' Synthetic remittance ',
			},
			{id: 'account', currency: 'EUR'},
		);

		expect(values.dedupeKey).toBe(
			createLegacyFallbackDedupeKey({
				providerTransactionId: null,
				entryReference: null,
				bookingDate: '2026-09-01',
				valueDate: '2026-09-02',
				amount: '-12.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				description: ' Synthetic test payment ',
				counterpartyName: ' Synthetic Counterparty ',
				remittanceInformation: ' Synthetic remittance ',
			}),
		);
	});

	it('keeps an entry-referenced transaction identity when mutable provider details change', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id-a',
			entryReference: 'stable-entry-reference',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic detail before update',
			counterpartyName: 'Synthetic Counterparty A',
			bankTransactionDescription: 'Synthetic payment before update',
			referenceNumber: 'synthetic-reference-before',
			referenceNumberScheme: 'SYNTHETIC_A',
		};
		const first = toBankTransactionValues(service, transaction, {id: 'account', currency: 'EUR'});
		const refreshed = toBankTransactionValues(
			service,
			{
				...transaction,
				providerTransactionId: 'volatile-provider-id-b',
				description: 'Synthetic detail after update',
				counterpartyName: 'Synthetic Counterparty B',
				bankTransactionDescription: 'Synthetic payment after update',
				referenceNumber: 'synthetic-reference-after',
				referenceNumberScheme: 'SYNTHETIC_B',
			},
			{id: 'account', currency: 'EUR'},
		);

		expect(first.stableIdentityKey).toBe(refreshed.stableIdentityKey);
	});

	it('does not merge distinct transactions that share an entry reference', () => {
		const service = createServiceForTransactionValues();
		const first = toBankTransactionValues(
			service,
			{
				providerTransactionId: 'volatile-provider-id-a',
				entryReference: 'reused-entry-reference',
				amount: '12.00',
				currency: 'EUR',
				bookingDate: '2026-09-01',
				description: 'Synthetic test payment A',
			},
			{id: 'account', currency: 'EUR'},
		);
		const second = toBankTransactionValues(
			service,
			{
				providerTransactionId: 'volatile-provider-id-b',
				entryReference: 'reused-entry-reference',
				amount: '13.00',
				currency: 'EUR',
				bookingDate: '2026-09-01',
				description: 'Synthetic test payment B',
			},
			{id: 'account', currency: 'EUR'},
		);

		expect(first.stableIdentityKey).not.toBe(second.stableIdentityKey);
	});

	it.each([
		['transaction dates', 'transactionDate', '2026-08-31', '2026-09-02'],
		['bank transaction codes', 'bankTransactionCode', 'CODE_A', 'CODE_B'],
		['bank transaction subcodes', 'bankTransactionSubCode', 'SUBCODE_A', 'SUBCODE_B'],
		['bank transaction descriptions', 'bankTransactionDescription', 'Synthetic detail A', 'Synthetic detail B'],
		['merchant category codes', 'merchantCategoryCode', '1111', '2222'],
		['provider reference numbers', 'referenceNumber', 'synthetic-reference-a', 'synthetic-reference-b'],
		['provider reference schemes', 'referenceNumberScheme', 'SCHEME_A', 'SCHEME_B'],
	] as const)('does not merge transactions with different %s', (_label, field, firstValue, secondValue) => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
		};
		const [first, second] = assignBankTransactionStableIdentityKeys([
			toBankTransactionValues(service, {...transaction, [field]: firstValue}, {id: 'account', currency: 'EUR'}),
			toBankTransactionValues(service, {...transaction, [field]: secondValue}, {id: 'account', currency: 'EUR'}),
		]);

		expect(first.stableIdentityKey).not.toBe(second.stableIdentityKey);
	});

	it('does not merge transactions with different provider locations', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			counterpartyLocation: {city: 'Synthetic City A', region: 'Synthetic Region', country: 'ZZ'},
		};
		const [first, second] = assignBankTransactionStableIdentityKeys([
			toBankTransactionValues(service, transaction, {id: 'account', currency: 'EUR'}),
			toBankTransactionValues(
				service,
				{...transaction, counterpartyLocation: {...transaction.counterpartyLocation, city: 'Synthetic City B'}},
				{id: 'account', currency: 'EUR'},
			),
		]);

		expect(first.stableIdentityKey).not.toBe(second.stableIdentityKey);
	});

	it('does not merge transactions with different instructed amounts or exchange rates', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			instructedAmount: '20.00',
			instructedCurrency: 'USD',
			exchangeRate: '1.1000',
			exchangeRateUnitCurrency: 'USD',
			exchangeRateType: 'SYNTHETIC',
		};
		const [first, differentInstructedAmount, differentExchangeRate] = assignBankTransactionStableIdentityKeys([
			toBankTransactionValues(service, transaction, {id: 'account', currency: 'EUR'}),
			toBankTransactionValues(
				service,
				{...transaction, instructedAmount: '21.00'},
				{id: 'account', currency: 'EUR'},
			),
			toBankTransactionValues(
				service,
				{...transaction, exchangeRate: '1.2000'},
				{id: 'account', currency: 'EUR'},
			),
		]);

		expect(first.stableIdentityKey).not.toBe(differentInstructedAmount.stableIdentityKey);
		expect(first.stableIdentityKey).not.toBe(differentExchangeRate.stableIdentityKey);
	});

	it('does not use provider transaction IDs as identity when no entry reference is available', () => {
		const service = createServiceForTransactionValues();
		const transaction = {
			providerTransactionId: 'volatile-provider-id-a',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			counterpartyName: 'Synthetic Counterparty',
			remittanceInformation: 'Fixture reference',
		};
		const first = toBankTransactionValues(
			service,
			transaction,
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);
		const nextFetch = toBankTransactionValues(
			service,
			{...transaction, providerTransactionId: 'volatile-provider-id-b'},
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);

		const amountWithDifferentScale = toBankTransactionValues(
			service,
			{...transaction, providerTransactionId: 'volatile-provider-id-c', amount: '12.00000000'},
			{id: 'account', currency: 'EUR'},
			'enable-banking',
			'Synthetic Bank',
		);

		expect(first.stableIdentityKey).toEqual(expect.any(String));
		expect(first.stableIdentityKey).toBe(nextFetch.stableIdentityKey);
		expect(first.stableIdentityKey).toBe(amountWithDifferentScale.stableIdentityKey);
	});

	it('does not merge distinct transactions that happen to share a provider transaction ID', () => {
		const service = createServiceForTransactionValues();
		const first = toBankTransactionValues(
			service,
			{
				providerTransactionId: 'reused-provider-id',
				amount: '12.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				bookingDate: '2026-09-01',
				description: 'Synthetic test payment A',
			},
			{id: 'account', currency: 'EUR'},
		);
		const second = toBankTransactionValues(
			service,
			{
				providerTransactionId: 'reused-provider-id',
				amount: '13.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				bookingDate: '2026-09-01',
				description: 'Synthetic test payment B',
			},
			{id: 'account', currency: 'EUR'},
		);

		expect(first.stableIdentityKey).toEqual(expect.any(String));
		expect(first.stableIdentityKey).not.toBe(second.stableIdentityKey);
	});

	it('preserves multiple identical no-reference transactions returned in one sync', async () => {
		const service = createServiceForTransactionValues();
		const insertQueryBuilder = {
			insert: jest.fn().mockReturnThis(),
			into: jest.fn().mockReturnThis(),
			values: jest.fn().mockReturnThis(),
			orIgnore: jest.fn().mockReturnThis(),
			orUpdate: jest.fn().mockReturnThis(),
			returning: jest.fn().mockReturnThis(),
			updateEntity: jest.fn().mockReturnThis(),
			execute: jest.fn().mockResolvedValue({raw: []}),
		};
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: jest.fn().mockResolvedValue([]),
			createQueryBuilder: jest.fn().mockReturnValue(insertQueryBuilder),
		} as unknown as Repository<BankTransaction>;
		const transaction = {
			providerTransactionId: 'volatile-provider-id',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description: 'Synthetic test payment',
			counterpartyName: 'Synthetic Counterparty',
		};

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(
			repository,
			{id: 'account', currency: 'EUR'} as BankAccount,
			[transaction, {...transaction, providerTransactionId: 'another-volatile-id'}],
			'Synthetic Bank',
			'enable-banking',
		);

		const persisted = insertQueryBuilder.values.mock.calls[0][0] as Array<{stableIdentityKey: string}>;
		expect(persisted).toHaveLength(2);
		expect(new Set(persisted.map(({stableIdentityKey}) => stableIdentityKey)).size).toBe(2);
	});

	it('reuses a no-reference row when mutable provider details change', async () => {
		const service = createServiceForTransactionValues();
		const insertQueryBuilder = {
			insert: jest.fn().mockReturnThis(),
			into: jest.fn().mockReturnThis(),
			values: jest.fn().mockReturnThis(),
			orIgnore: jest.fn().mockReturnThis(),
			orUpdate: jest.fn().mockReturnThis(),
			returning: jest.fn().mockReturnThis(),
			updateEntity: jest.fn().mockReturnThis(),
			execute: jest.fn().mockResolvedValue({raw: []}),
		};
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const originalTransaction = {
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			description: 'Synthetic detail before update',
			counterpartyName: 'Synthetic counterparty before update',
		};
		const originalValue = toBankTransactionValues(
			service,
			originalTransaction,
			bankAccount as unknown as Record<string, unknown>,
		);
		const originalLegacyDedupeKey = createLegacyFallbackDedupeKey({
			providerTransactionId: null,
			entryReference: null,
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			amount: '-12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			description: 'Synthetic detail before update',
			counterpartyName: 'Synthetic counterparty before update',
			remittanceInformation: null,
		});
		const existingTransaction = {
			...originalValue,
			id: 'existing-transaction-id',
			dedupeKey: originalLegacyDedupeKey,
			categoryStatus: 'COMPLETED',
		};
		const repositoryFind = jest
			.fn()
			.mockResolvedValueOnce([existingTransaction])
			.mockResolvedValueOnce([existingTransaction])
			.mockResolvedValueOnce([{id: existingTransaction.id}]);
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: repositoryFind,
			createQueryBuilder: jest.fn().mockReturnValue(insertQueryBuilder),
		} as unknown as Repository<BankTransaction>;
		const refreshedTransaction = {
			...originalTransaction,
			description: 'Synthetic detail after update',
			counterpartyName: 'Synthetic counterparty after update',
		};

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(repository, bankAccount, [refreshedTransaction], 'Synthetic Bank', 'enable-banking');

		expect(repositoryFind).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				where: expect.objectContaining({
					bankAccountId: bankAccount.id,
					stableIdentityGroupKey: expect.any(Object),
				}),
			}),
		);
		const persistedValues = insertQueryBuilder.values.mock.calls[0][0] as Array<Record<string, unknown>>;
		expect(persistedValues[0]).toMatchObject({
			stableIdentityKey: originalValue.stableIdentityKey,
		});
		expect(persistedValues[0].dedupeKey).not.toBe(originalLegacyDedupeKey);
		expect(persistedValues[0].dedupeKey).not.toMatch(/^[a-f0-9]{64}$/);
	});

	it('stores currency exchange metadata and skips the categorization input hash', () => {
		const service = createServiceForTransactionValues();
		const values = toBankTransactionValues(
			service,
			{
				id: 'provider-transaction-id',
				amount: '10.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				description: ' Exchanged   to GBP ',
			},
			{id: 'bank-account-id', currency: 'EUR'},
		);

		expect(values).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			financialEventSource: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
			financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
			categoryInputHash: null,
		});
	});

	it('keeps an existing non-manual exchange row out of categorization after reclassification', async () => {
		const service = createServiceForTransactionValues();
		const insertQueryBuilder = {
			insert: jest.fn().mockReturnThis(),
			into: jest.fn().mockReturnThis(),
			values: jest.fn().mockReturnThis(),
			orIgnore: jest.fn().mockReturnThis(),
			orUpdate: jest.fn().mockReturnThis(),
			returning: jest.fn().mockReturnThis(),
			updateEntity: jest.fn().mockReturnThis(),
			execute: jest.fn().mockResolvedValue({raw: []}),
		};
		const eventUpdateQueryBuilder = {
			update: jest.fn().mockReturnThis(),
			set: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			execute: jest.fn().mockResolvedValue({affected: 1}),
		};
		const repositoryFind = jest.fn();
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: repositoryFind,
			createQueryBuilder: jest
				.fn()
				.mockReturnValueOnce(insertQueryBuilder)
				.mockReturnValueOnce(eventUpdateQueryBuilder),
		} as unknown as Repository<BankTransaction>;
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const transaction = {
			id: 'provider-transaction-id',
			providerTransactionId: 'provider-transaction-id',
			amount: '10.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			description: 'Exchanged to GBP',
		};
		const mappedValue = toBankTransactionValues(
			service,
			transaction,
			bankAccount as unknown as Record<string, unknown>,
		);
		const legacyDedupeKey = createHash('sha256').update('transaction:provider-transaction-id').digest('hex');
		transaction.providerTransactionId = 'changed-provider-transaction-id';
		repositoryFind
			.mockResolvedValueOnce([
				{
					...mappedValue,
					id: 'existing-transaction-id',
					dedupeKey: legacyDedupeKey,
					categoryInputHash: 'legacy-input-hash',
					categorySource: null,
				},
			])
			.mockResolvedValueOnce([{stableIdentityKey: mappedValue.stableIdentityKey}])
			.mockResolvedValueOnce([{id: 'existing-transaction-id'}]);

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(repository, bankAccount, [transaction], 'Revolut', 'enable-banking');

		expect(repositoryFind).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				where: expect.objectContaining({
					bankAccountId: bankAccount.id,
					stableIdentityGroupKey: expect.any(Object),
				}),
			}),
		);
		const persistedValues = insertQueryBuilder.values.mock.calls[0][0] as Array<Record<string, unknown>>;
		expect(persistedValues[0]).toMatchObject({
			providerTransactionId: 'changed-provider-transaction-id',
			stableIdentityKey: mappedValue.stableIdentityKey,
		});
		expect(persistedValues[0].dedupeKey).not.toBe(legacyDedupeKey);
		expect(persistedValues[0].dedupeKey).not.toMatch(/^[a-f0-9]{64}$/);
		expect(insertQueryBuilder.orUpdate).toHaveBeenCalledWith(
			expect.any(Array),
			['bankAccountId', 'stableIdentityKey'],
			expect.objectContaining({
				overwriteCondition: {
					where: '("bank_transactions"."categoryStatus" IS DISTINCT FROM :processingStatus OR EXCLUDED."financialEventType" = :currencyExchangeType)',
					parameters: {
						processingStatus: 'PROCESSING',
						currencyExchangeType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
					},
				},
			}),
		);
		expect(eventUpdateQueryBuilder.set).toHaveBeenCalledWith(
			expect.objectContaining({categoryStatus: 'NOT_APPLICABLE', categoryInputHash: null}),
		);
		expect(repository.createQueryBuilder).toHaveBeenCalledTimes(2);
	});

	it('resets stale categorization for all qualifying existing rows in one guarded update', async () => {
		const service = createServiceForTransactionValues();
		const queryBuilder = {
			insert: jest.fn().mockReturnThis(),
			into: jest.fn().mockReturnThis(),
			values: jest.fn().mockReturnThis(),
			orIgnore: jest.fn().mockReturnThis(),
			orUpdate: jest.fn().mockReturnThis(),
			returning: jest.fn().mockReturnThis(),
			updateEntity: jest.fn().mockReturnThis(),
			update: jest.fn().mockReturnThis(),
			set: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			execute: jest.fn().mockResolvedValue({raw: []}),
		};
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const transactions = ['Synthetic grocer', 'Synthetic cafe', 'Synthetic bakery'].map((description, index) => ({
			providerTransactionId: `provider-transaction-${index}`,
			amount: `${index + 1}.00`,
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			bookingDate: '2026-09-01',
			description,
		}));
		const existingTransactions = transactions.map((transaction, index) => ({
			...toBankTransactionValues(service, transaction, bankAccount as unknown as Record<string, unknown>),
			id: `existing-transaction-${index}`,
			categoryInputHash: 'stale-input-hash',
			categorySource: null,
			categoryStatus: index === 2 ? 'COMPLETED' : 'FAILED',
		}));
		const repositoryFind = jest
			.fn()
			.mockResolvedValueOnce(existingTransactions)
			.mockResolvedValueOnce(existingTransactions)
			.mockResolvedValueOnce(existingTransactions.map(({id}) => ({id})));
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: repositoryFind,
			createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
		} as unknown as Repository<BankTransaction>;

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(repository, bankAccount, transactions, 'Synthetic Bank', 'enable-banking');

		expect(queryBuilder.update).toHaveBeenCalledTimes(1);
		expect(queryBuilder.set).toHaveBeenCalledWith(
			expect.objectContaining({categoryStatus: 'PENDING', categoryUpdatedAt: null, category: null}),
		);
		expect(queryBuilder.where).toHaveBeenCalledWith('id IN (:...ids)', {
			ids: ['existing-transaction-0', 'existing-transaction-1'],
		});
		expect(queryBuilder.andWhere).toHaveBeenCalledWith(`"categorySource" IS DISTINCT FROM 'MANUAL'`);
		expect(queryBuilder.andWhere).toHaveBeenCalledWith('"financialEventType" IS NULL');
		expect(repository.createQueryBuilder).toHaveBeenCalledTimes(2);
	});

	it('preserves existing occurrence identities when mutable details reorder repeated-reference rows', async () => {
		const service = createServiceForTransactionValues();
		const insertQueryBuilder = {
			insert: jest.fn().mockReturnThis(),
			into: jest.fn().mockReturnThis(),
			values: jest.fn().mockReturnThis(),
			orIgnore: jest.fn().mockReturnThis(),
			orUpdate: jest.fn().mockReturnThis(),
			returning: jest.fn().mockReturnThis(),
			updateEntity: jest.fn().mockReturnThis(),
			execute: jest.fn().mockResolvedValue({raw: []}),
		};
		const bankAccount = {id: 'bank-account-id', currency: 'EUR'} as BankAccount;
		const firstTransaction = {
			providerTransactionId: 'synthetic-row-a',
			entryReference: 'shared-entry-reference',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			description: 'Alpha',
			counterpartyName: 'Synthetic Counterparty A',
			referenceNumber: 'reference-a',
		};
		const secondTransaction = {
			providerTransactionId: 'synthetic-row-b',
			entryReference: 'shared-entry-reference',
			amount: '12.00',
			currency: 'EUR',
			creditDebitIndicator: 'DBIT',
			transactionDate: '2026-09-01',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			description: 'Beta',
			counterpartyName: 'Synthetic Counterparty B',
			referenceNumber: 'reference-b',
		};
		const asIdentityInput = (transaction: typeof firstTransaction | typeof secondTransaction) =>
			toBankTransactionValues(
				service,
				transaction,
				bankAccount as unknown as Record<string, unknown>,
			) as unknown as BankTransactionIdentityInput & {
				providerTransactionId: string;
			};
		const initialValues = assignBankTransactionStableIdentityKeys(
			[firstTransaction, secondTransaction].map(asIdentityInput),
		);
		const initialKeysByProviderId = new Map(
			initialValues.map(({providerTransactionId, stableIdentityKey}) => [
				providerTransactionId,
				stableIdentityKey,
			]),
		);
		const existingTransactions = initialValues.map((value, index) => ({
			...value,
			id: `existing-transaction-${index}`,
			dedupeKey: `legacy-dedupe-key-${index}`,
			categorySource: 'AI',
			categoryStatus: 'COMPLETED',
		}));
		const repository = {
			query: jest.fn().mockResolvedValue([]),
			find: jest
				.fn()
				.mockResolvedValueOnce(existingTransactions)
				.mockResolvedValueOnce(existingTransactions)
				.mockResolvedValueOnce(existingTransactions.map(({id}) => ({id}))),
			createQueryBuilder: jest.fn().mockReturnValue(insertQueryBuilder),
		} as unknown as Repository<BankTransaction>;
		const updatedFirstTransaction = {
			...firstTransaction,
			description: 'Zulu',
			counterpartyName: 'Synthetic Counterparty A Updated',
			referenceNumber: 'reference-z',
		};

		await (
			service as unknown as {
				persistTransactions: (...args: unknown[]) => Promise<unknown>;
			}
		).persistTransactions(
			repository,
			bankAccount,
			[updatedFirstTransaction, secondTransaction],
			'Synthetic Bank',
			'enable-banking',
		);

		const persistedValues = insertQueryBuilder.values.mock.calls[0][0] as Array<{
			providerTransactionId: string;
			stableIdentityKey: string;
		}>;
		expect(
			new Map(
				persistedValues.map(({providerTransactionId, stableIdentityKey}) => [
					providerTransactionId,
					stableIdentityKey,
				]),
			),
		).toEqual(initialKeysByProviderId);
	});

	it('does not classify an ordinary card payment that contains exchange metadata', () => {
		const service = createServiceForTransactionValues();
		const values = toBankTransactionValues(
			service,
			{
				id: 'provider-card-payment-id',
				amount: '10.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				description: 'Card payment',
				exchangeRate: '1.12',
				exchangeRateUnitCurrency: 'USD',
			},
			{id: 'bank-account-id', currency: 'EUR'},
		);

		expect(values.financialEventType).toBeNull();
		expect(values.categoryInputHash).toEqual(expect.any(String));
	});
});
