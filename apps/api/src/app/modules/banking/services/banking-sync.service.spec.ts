import Redis from 'ioredis';

import {BANKING_SERVICE_UNAVAILABLE} from '../api/constants/banking-messages.constants';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {BankSyncRun} from '../bank-sync-run.entity';
import {EnableBankingTransactionsResult} from '../enable-banking.types';
import {BankTransactionPersistenceService} from './bank-transaction-persistence.service';
import {BankingConnectionLockService} from './banking-connection-lock.service';
import {BankingSyncService} from './banking-sync.service';
import {EnableBankingClientError} from './enable-banking.client';

const NO_TRANSACTIONS: EnableBankingTransactionsResult = {transactions: [], unparseableCount: 0};

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
	'bankTransactionPersistenceService',
	'aspspCatalogService',
	'reportingCurrencyService',
] as const;

const DEFAULT_DEPENDENCIES: Partial<Record<string, unknown>> = {
	ownTransferService: {recomputeForOwnerSafely: jest.fn().mockResolvedValue(undefined)},
	currencyExchangeService: {recomputeForOwnerSafely: jest.fn().mockResolvedValue([])},
	merchantLogoService: {enqueueForOwnerSafely: jest.fn().mockResolvedValue(undefined)},
	bankTransactionPersistenceService: new BankTransactionPersistenceService(),
	reportingCurrencyService: {reconcileSafely: jest.fn().mockResolvedValue(undefined)},
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

function createInsertQueryBuilder(raw: Array<{id: string; inserted: boolean}>) {
	return {
		insert: jest.fn().mockReturnThis(),
		into: jest.fn().mockReturnThis(),
		values: jest.fn().mockReturnThis(),
		orIgnore: jest.fn().mockReturnThis(),
		orUpdate: jest.fn().mockReturnThis(),
		returning: jest.fn().mockReturnThis(),
		updateEntity: jest.fn().mockReturnThis(),
		execute: jest.fn().mockResolvedValue({raw}),
	};
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
				aspspCatalogService: {
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
	let transactionGate: Deferred<EnableBankingTransactionsResult>;
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
	let ownTransferService: {recomputeForOwnerSafely: jest.Mock};
	let currencyExchangeService: {recomputeForOwnerSafely: jest.Mock};

	beforeEach(() => {
		jest.useFakeTimers();
		transactionGate = deferred<EnableBankingTransactionsResult>();
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
				callback({
					getRepository: jest.fn().mockReturnValue(transactionRepository),
					query: jest.fn().mockResolvedValue([]),
				}),
			),
			getRepository: jest.fn().mockReturnValue(transactionRepository),
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
		ownTransferService = {recomputeForOwnerSafely: jest.fn().mockResolvedValue(undefined)};
		currencyExchangeService = {recomputeForOwnerSafely: jest.fn().mockResolvedValue([])};

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
			ownTransferService,
			currencyExchangeService,
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
		enableBankingClient.getAccountTransactions.mockResolvedValueOnce(NO_TRANSACTIONS);

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
		const insertQueryBuilder = createInsertQueryBuilder([
			{id: 'existing-transaction-id', inserted: false},
			{id: 'new-transaction-id', inserted: true},
		]);
		transactionRepository.createQueryBuilder.mockReturnValue(insertQueryBuilder);
		// Sync reads back the rows it wrote, by identity, to hand them to categorization and logos.
		transactionRepository.find
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{id: 'existing-transaction-id'}, {id: 'new-transaction-id'}]);
		enableBankingClient.getAccountTransactions.mockResolvedValue({transactions, unparseableCount: 0});
		currencyExchangeService.recomputeForOwnerSafely.mockResolvedValue([
			'reclassified-transaction-id',
			'new-transaction-id',
		]);
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
		// Own transfers are recomputed around the written rows and the rows whose exchange classification changed.
		expect(ownTransferService.recomputeForOwnerSafely).toHaveBeenCalledWith('account-id', {
			transactionIds: ['existing-transaction-id', 'new-transaction-id', 'reclassified-transaction-id'],
		});
		// The written rows bring their new merchants to logo identification.
		expect(merchantLogoService.enqueueForOwnerSafely).toHaveBeenCalledWith('account-id', [
			'existing-transaction-id',
			'new-transaction-id',
		]);
	});

	it('leaves own transfers alone after a sync that wrote nothing', async () => {
		transactionGate.resolve(NO_TRANSACTIONS);

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({status: 'SUCCEEDED'});
		// An empty scope does no work (OwnTransferService).
		expect(ownTransferService.recomputeForOwnerSafely.mock.calls).toEqual([['account-id', {transactionIds: []}]]);
	});

	it('recomputes own transfers around rows that stopped being exchanges, even when the sync stored no rows', async () => {
		transactionGate.resolve(NO_TRANSACTIONS);
		// A removed pending leg leaves its booked counterpart a plain row that may now pair as an own transfer.
		currencyExchangeService.recomputeForOwnerSafely.mockResolvedValue(['former-exchange-leg-id']);

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({status: 'SUCCEEDED'});
		expect(ownTransferService.recomputeForOwnerSafely.mock.calls).toEqual([
			['account-id', {transactionIds: ['former-exchange-leg-id']}],
		]);
	});

	it('recomputes own transfers around the former counterparts of removed pending rows', async () => {
		transactionGate.resolve(NO_TRANSACTIONS);
		// The fetch no longer returns two pending rows; one of them was paired with a row that may have had evidence
		// only through it.
		transactionRepository.query.mockImplementation(async (sql: string) =>
			sql.includes('DELETE FROM')
				? [[{ownTransferCounterpartId: 'former-counterpart-id'}, {ownTransferCounterpartId: null}], 2]
				: [],
		);

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({status: 'SUCCEEDED'});
		expect(ownTransferService.recomputeForOwnerSafely.mock.calls).toEqual([
			['account-id', {transactionIds: ['former-counterpart-id']}],
		]);
	});

	it('recomputes own transfers over the whole history when the exchange recompute failed', async () => {
		transactionGate.resolve(NO_TRANSACTIONS);
		// A failed recompute may still have committed, so which rows it reclassified is unknown.
		currencyExchangeService.recomputeForOwnerSafely.mockResolvedValue(null);

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({status: 'SUCCEEDED'});
		expect(ownTransferService.recomputeForOwnerSafely).toHaveBeenCalledWith('account-id', undefined);
	});

	it.each([
		['a Retry-After inside the window', 'ASPSP_RATE_LIMIT_EXCEEDED', 429, 7_200, 7_200],
		['no Retry-After, whatever the background interval', 'ASPSP_RATE_LIMIT_EXCEEDED', 400, undefined, 21_600],
		['a zero Retry-After', 'ASPSP_RATE_LIMIT_EXCEEDED', 400, 0, 900],
		['a Retry-After beyond a day', 'ASPSP_RATE_LIMIT_EXCEEDED', 429, 8_000_000_000_000, 86_400],
		['HTTP 429 with another code', 'provider_temporarily_unavailable', 429, 120, 900],
	])(
		'waits out a rate limit with %s for the clamped cooldown before the next automatic synchronization',
		async (_case, code, status, retryAfterSeconds, cooldownSeconds) => {
			configurationService.get.mockReturnValue('1h');
			transactionGate.resolve(NO_TRANSACTIONS);
			enableBankingClient.getAccountBalances.mockRejectedValueOnce(
				new EnableBankingClientError(code, status, retryAfterSeconds),
			);

			await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({
				rateLimitSource: 'enable-banking',
				retryAfterSeconds: cooldownSeconds,
			});

			// The rate limit stops the run before the account's transactions are requested.
			expect(enableBankingClient.getAccountTransactions).not.toHaveBeenCalled();
			const connectionUpdate = transactionRepository.update.mock.calls
				.map(([, values]) => values)
				.find((values) => values?.syncStatus === 'RATE_LIMITED');
			const delayMs = connectionUpdate.nextSyncAt.getTime() - Date.now();
			expect(delayMs).toBeGreaterThan(cooldownSeconds * 1000 - 1000);
			expect(delayMs).toBeLessThanOrEqual(cooldownSeconds * 1000);
		},
	);

	it('backs off when session validation is rate-limited', async () => {
		enableBankingClient.getSessionAccounts.mockRejectedValueOnce(
			new EnableBankingClientError('ASPSP_RATE_LIMIT_EXCEEDED', 400, 1_800),
		);

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({
			retryAfterSeconds: 1_800,
		});

		expect(enableBankingClient.getAccountBalances).not.toHaveBeenCalled();
		const connectionUpdate = transactionRepository.update.mock.calls
			.map(([, values]) => values)
			.find((values) => values?.syncStatus === 'RATE_LIMITED');
		expect(connectionUpdate.nextSyncAt.getTime() - Date.now()).toBeGreaterThan(1_799_000);
	});

	it('answers 409 without starting a run when the connection changed before the claim', async () => {
		bankConnectionRepository.update.mockResolvedValueOnce({affected: 0});

		await expect(service.synchronizeAutomatically('connection-id')).rejects.toMatchObject({
			status: 409,
			message: 'The bank connection changed during synchronization. Please try again.',
		});
		expect(bankSyncRunRepository.save).not.toHaveBeenCalled();
		expect(enableBankingClient.getSessionAccounts).not.toHaveBeenCalled();
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

		transactionGate.resolve(NO_TRANSACTIONS);

		await secondSyncResult;
		await expect(firstSync).resolves.toEqual(
			expect.objectContaining({
				id: 'run-id',
				status: 'SUCCEEDED',
			}),
		);
		expect(redis.eval.mock.calls.some(([script]) => String(script).includes('expire'))).toBe(true);
	});

	it('imports the readable rows and marks the run partial when the provider sends unreadable transactions', async () => {
		const insertQueryBuilder = createInsertQueryBuilder([{id: 'readable-transaction-id', inserted: true}]);
		transactionRepository.createQueryBuilder.mockReturnValue(insertQueryBuilder);
		enableBankingClient.getAccountTransactions.mockResolvedValue({
			transactions: [{providerTransactionId: 'readable-transaction', amount: '20.00', currency: 'EUR'}],
			unparseableCount: 3,
		});

		await service.synchronizeAutomatically('connection-id');

		expect(insertQueryBuilder.values).toHaveBeenCalledWith([
			expect.objectContaining({providerTransactionId: 'readable-transaction'}),
		]);
		expect(transactionRepository.update).toHaveBeenCalledWith(
			{id: 'run-id'},
			expect.objectContaining({
				status: 'PARTIAL',
				transactionsFetched: 1,
				errorMessage: 'Some bank data could not be synchronized.',
				failures: [
					{
						kind: 'transactions',
						bankAccountId: 'bank-account-id',
						code: 'unparseable_transactions',
						httpStatus: null,
						retryAfter: false,
						droppedTransactions: 3,
					},
				],
			}),
		);
	});

	it('returns a committed run when lock renewal fails after the commit', async () => {
		transactionGate.resolve(NO_TRANSACTIONS);
		const ownTransferService = {
			// Runs after the sync transaction commits.
			recomputeForOwnerSafely: jest.fn(async () => {
				renewalShouldFail = true;
				await jest.advanceTimersByTimeAsync((15 * 60 * 1000) / 3 + 1);
			}),
		};
		service = createBankingSyncService({
			bankConnectionRepository,
			bankAccountRepository,
			bankSyncRunRepository,
			dataSource: {
				transaction: jest.fn(async (callback: (manager: unknown) => Promise<void>) =>
					callback({
						getRepository: jest.fn().mockReturnValue(transactionRepository),
						query: jest.fn().mockResolvedValue([]),
					}),
				),
				getRepository: jest.fn().mockReturnValue(transactionRepository),
			},
			enableBankingClient,
			encryptionService: {decrypt: jest.fn().mockReturnValue('provider-session')},
			connectionLockService: new BankingConnectionLockService(redis as unknown as Redis),
			categorizationService: {enqueueForTransactions: jest.fn().mockResolvedValue(undefined)},
			configurationService,
			merchantLogoService,
			ownTransferService,
		});

		await expect(service.synchronizeAutomatically('connection-id')).resolves.toMatchObject({
			id: 'run-id',
			status: 'SUCCEEDED',
		});
		expect(ownTransferService.recomputeForOwnerSafely).toHaveBeenCalledTimes(1);
		expect(bankConnectionRepository.update).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({syncStatus: 'FAILED'}),
		);
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
		transactionGate.resolve(NO_TRANSACTIONS);

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
