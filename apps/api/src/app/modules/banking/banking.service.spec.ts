import {createHash} from 'node:crypto';

import {BANKING_SERVICE_UNAVAILABLE} from './api/constants/banking-messages.constants';
import {BankConnection} from './bank-connection.entity';
import {BankingService} from './banking.service';

function hashState(state: string): string {
	return createHash('sha256').update(state).digest('hex');
}

const BANKING_SERVICE_DEPENDENCIES = [
	'bankConnectionRepository',
	'bankAccountRepository',
	'bankAccountBalanceRepository',
	'accountService',
	'configurationService',
	'dataSource',
	'enableBankingClient',
	'authorizationStateService',
	'encryptionService',
	'connectionLockService',
	'bankingSyncQueueService',
	'ownTransferService',
] as const;

/** An owner whose base currency is not chosen yet, so balances are not converted. */
const OWNER = {id: 'owner-account-id', baseCurrency: null};

const DEFAULT_DEPENDENCIES: Partial<Record<string, unknown>> = {
	ownTransferService: {recomputeForOwnerSafely: jest.fn().mockResolvedValue(undefined)},
};

/** Builds the service with named test doubles; unspecified dependencies are empty objects. */
function createBankingService(
	dependencies: Partial<Record<(typeof BANKING_SERVICE_DEPENDENCIES)[number], unknown>> = {},
): BankingService {
	return new BankingService(
		...(BANKING_SERVICE_DEPENDENCIES.map(
			(name) => dependencies[name] ?? DEFAULT_DEPENDENCIES[name] ?? {},
		) as ConstructorParameters<typeof BankingService>),
	);
}

describe('BankingService disabled integration', () => {
	it('blocks provider authorization and callback state consumption when disabled', async () => {
		const bankConnectionRepository = {findOne: jest.fn(), save: jest.fn()};
		const enableBankingClient = {getAspsps: jest.fn(), startAuthorization: jest.fn()};
		const authorizationStateService = {consumeWithStatus: jest.fn()};
		const service = createBankingService({
			bankConnectionRepository,
			configurationService: {
				get: jest.fn((key: string) => (key === 'BANKING_INTEGRATION_ENABLED' ? false : undefined)),
			},
			enableBankingClient,
			authorizationStateService,
		});

		await expect(
			service.startAuthorization('account-id', {aspspName: 'Example Bank', aspspCountry: 'NL'} as never),
		).rejects.toMatchObject({status: 503, message: BANKING_SERVICE_UNAVAILABLE});
		await expect(service.findSupportedAspsps()).rejects.toThrow(BANKING_SERVICE_UNAVAILABLE);
		await expect(service.handleCallback({state: 'state', code: 'code'})).resolves.toBe('error');

		expect(bankConnectionRepository.findOne).not.toHaveBeenCalled();
		expect(bankConnectionRepository.save).not.toHaveBeenCalled();
		expect(enableBankingClient.getAspsps).not.toHaveBeenCalled();
		expect(enableBankingClient.startAuthorization).not.toHaveBeenCalled();
		expect(authorizationStateService.consumeWithStatus).not.toHaveBeenCalled();
	});
});

describe('BankingService authorization state lifecycle', () => {
	it('does not acquire the mutation lock before ownership is confirmed', async () => {
		const bankConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(null),
		};
		const connectionLockService = {
			acquire: jest.fn(),
		};
		const service = createBankingService({
			bankConnectionRepository,
			connectionLockService,
			bankingSyncQueueService: {enqueueInitialSync: jest.fn()},
		});

		await expect(service.removeConnection('owner-account-id', 'connection-id')).rejects.toMatchObject({
			status: 404,
		});
		expect(connectionLockService.acquire).not.toHaveBeenCalled();
	});

	it('stops and releases the mutation lock when deletion fails', async () => {
		const connection = {id: 'connection-id', status: 'AUTHORIZED'} as BankConnection;
		const bankConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(connection),
		};
		const transactionConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(connection),
			find: jest.fn().mockResolvedValue([]),
			remove: jest.fn().mockRejectedValue(new Error('deletion failed')),
		};
		const transactionBankAccountRepository = {
			count: jest.fn().mockResolvedValue(0),
		};
		const transactionManager = {
			getRepository: jest.fn((entity: unknown) =>
				entity === BankConnection ? transactionConnectionRepository : transactionBankAccountRepository,
			),
		};
		const dataSource = {
			transaction: jest.fn((callback: (manager: typeof transactionManager) => Promise<void>) =>
				callback(transactionManager),
			),
		};
		const connectionLock = {
			assertHealthy: jest.fn(),
			stop: jest.fn(),
			release: jest.fn().mockResolvedValue(undefined),
		};
		const connectionLockService = {
			acquire: jest.fn().mockResolvedValue(connectionLock),
		};
		const service = createBankingService({
			bankConnectionRepository,
			dataSource,
			connectionLockService,
			bankingSyncQueueService: {enqueueInitialSync: jest.fn()},
		});

		await expect(service.removeConnection('owner-account-id', connection.id, 'DELETE')).rejects.toThrow(
			'deletion failed',
		);
		expect(connectionLockService.acquire).toHaveBeenCalledWith(connection.id);
		expect(connectionLock.stop).toHaveBeenCalledTimes(1);
		expect(connectionLock.release).toHaveBeenCalledTimes(1);
	});

	it('does not expire a newer authorization state for the same connection', async () => {
		const expiredState = 'expired-state';
		const newerState = 'newer-state';
		const connection = {
			id: 'connection-id',
			status: 'PENDING_AUTHORIZATION',
			authorizationStateHash: hashState(newerState),
		};
		const bankConnectionRepository = {
			update: jest
				.fn()
				.mockImplementation((criteria: {status: string; authorizationStateHash: string}) =>
					Promise.resolve(
						criteria.status === connection.status &&
							criteria.authorizationStateHash === connection.authorizationStateHash
							? {affected: 1}
							: {affected: 0},
					),
				),
		};
		const authorizationStateService = {
			consumeWithStatus: jest.fn().mockResolvedValue(null),
		};
		const service = createBankingService({
			bankConnectionRepository,
			authorizationStateService,
			connectionLockService: {acquire: jest.fn()},
			bankingSyncQueueService: {enqueueInitialSync: jest.fn()},
		});

		await expect(service.handleCallback({state: expiredState, code: 'late-provider-code'})).resolves.toBe('error');

		expect(connection).toMatchObject({
			status: 'PENDING_AUTHORIZATION',
			authorizationStateHash: hashState(newerState),
		});
		expect(bankConnectionRepository.update).toHaveBeenCalledWith(
			{authorizationStateHash: hashState(expiredState), status: 'PENDING_AUTHORIZATION'},
			{status: 'FAILED', authorizationStateHash: null},
		);
	});

	it('does not authorize a callback after the pending state is replaced during the callback race', async () => {
		const callbackState = 'racing-state';
		const state = {
			accountId: 'account-id',
			connectionId: 'connection-id',
			aspspName: 'ABN AMRO',
			aspspCountry: 'NL',
			replacesConnectionId: null,
			expiresAt: Date.now() + 60_000,
		};
		const connection = {
			id: state.connectionId,
			status: 'PENDING_AUTHORIZATION',
			authorizationStateHash: hashState(callbackState),
		};
		const transactionConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(null),
		};
		const bankConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(connection),
			update: jest.fn().mockResolvedValue({affected: 0}),
		};
		const dataSource = {
			transaction: jest.fn(async (callback: (manager: unknown) => Promise<void>) =>
				callback({
					getRepository: jest.fn((entity: unknown) =>
						entity === BankConnection ? transactionConnectionRepository : {},
					),
				}),
			),
		};
		const authorizationStateService = {
			consumeWithStatus: jest.fn().mockResolvedValue({status: 'consumed', state}),
		};
		const service = createBankingService({
			bankConnectionRepository,
			dataSource,
			enableBankingClient: {
				createSession: jest.fn().mockResolvedValue({
					sessionId: 'provider-session',
					consentValidUntil: '2030-01-01T00:00:00.000Z',
					aspsp: {name: 'ABN AMRO', country: 'NL'},
					accounts: [],
				}),
			},
			authorizationStateService,
			encryptionService: {encrypt: jest.fn().mockReturnValue('encrypted-session')},
			connectionLockService: {
				acquire: jest.fn().mockResolvedValue({
					assertHealthy: jest.fn(),
					stop: jest.fn(),
					release: jest.fn().mockResolvedValue(undefined),
				}),
			},
			bankingSyncQueueService: {enqueueInitialSync: jest.fn()},
		});

		await expect(service.handleCallback({state: callbackState, code: 'provider-code'})).resolves.toBe('error');

		expect(transactionConnectionRepository.findOne).toHaveBeenCalledWith({
			where: {
				id: state.connectionId,
				status: 'PENDING_AUTHORIZATION',
				authorizationStateHash: hashState(callbackState),
				account: {id: state.accountId},
			},
			lock: {mode: 'pessimistic_write'},
		});
		expect(bankConnectionRepository.update).toHaveBeenCalledWith(
			{id: state.connectionId, status: 'PENDING_AUTHORIZATION', authorizationStateHash: hashState(callbackState)},
			{status: 'FAILED', authorizationStateHash: null},
		);
	});

	it('cleans all affected authorization states once after connection deletion commits', async () => {
		const connection = {
			id: 'authorized-connection',
			account: {id: 'account-id'},
			provider: 'enable-banking',
			aspspName: 'ABN AMRO',
			aspspCountry: 'NL',
			status: 'AUTHORIZED',
		};
		const pendingConnections = [{id: 'pending-connection-one'}, {id: 'pending-connection-two'}];
		const events: string[] = [];
		const transactionConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(connection),
			find: jest.fn().mockResolvedValue(pendingConnections),
			update: jest.fn().mockResolvedValue(undefined),
			remove: jest.fn().mockResolvedValue(undefined),
		};
		const bankConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(connection),
		};
		const authorizationStateService = {
			removeForConnection: jest.fn().mockResolvedValue(1),
			removeForConnections: jest.fn().mockImplementation(async () => {
				events.push('cleanup');
				return 3;
			}),
		};
		const dataSource = {
			transaction: jest.fn(async (callback: (manager: unknown) => Promise<void>) => {
				events.push('transaction-start');
				const result = await callback({
					getRepository: jest.fn((entity: unknown) =>
						entity === BankConnection ? transactionConnectionRepository : {count: jest.fn()},
					),
				});
				events.push('transaction-commit');
				return result;
			}),
		};
		const connectionLock = {
			assertHealthy: jest.fn(),
			stop: jest.fn(),
			release: jest.fn().mockResolvedValue(undefined),
		};
		const connectionLockService = {
			acquire: jest.fn().mockResolvedValue(connectionLock),
		};
		const service = createBankingService({
			bankConnectionRepository,
			dataSource,
			authorizationStateService,
			connectionLockService,
			bankingSyncQueueService: {enqueueInitialSync: jest.fn()},
		});

		await service.removeConnection('account-id', connection.id, 'DELETE');

		expect(events).toEqual(['transaction-start', 'transaction-commit', 'cleanup']);
		expect(authorizationStateService.removeForConnections).toHaveBeenCalledTimes(1);
		expect(authorizationStateService.removeForConnections).toHaveBeenCalledWith([
			'authorized-connection',
			'pending-connection-one',
			'pending-connection-two',
		]);
		expect(authorizationStateService.removeForConnection).not.toHaveBeenCalled();
	});

	it('queues the first automatic synchronization only after authorization commits', async () => {
		const callbackState = 'successful-state';
		const state = {
			accountId: 'account-id',
			connectionId: 'connection-id',
			aspspName: 'ABN AMRO',
			aspspCountry: 'NL',
			replacesConnectionId: null,
			expiresAt: Date.now() + 60_000,
		};
		const connection = {
			id: state.connectionId,
			status: 'PENDING_AUTHORIZATION',
			authorizationStateHash: hashState(callbackState),
		};
		const events: string[] = [];
		const transactionConnectionRepository = {
			findOne: jest.fn().mockResolvedValueOnce(connection).mockResolvedValueOnce(null),
			update: jest.fn().mockResolvedValue(undefined),
			delete: jest.fn().mockResolvedValue(undefined),
		};
		const bankConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(connection),
		};
		const dataSource = {
			transaction: jest.fn(async (callback: (manager: unknown) => Promise<void>) => {
				const result = await callback({
					getRepository: jest.fn((entity: unknown) =>
						entity === BankConnection ? transactionConnectionRepository : {findOne: jest.fn()},
					),
				});
				events.push('transaction-commit');
				return result;
			}),
		};
		const authorizationStateService = {
			consumeWithStatus: jest.fn().mockResolvedValue({status: 'consumed', state}),
		};
		const queueService = {
			enqueueInitialSync: jest.fn().mockImplementation(async () => {
				events.push('queue');
			}),
		};
		const connectionLock = {
			assertHealthy: jest.fn(),
			stop: jest.fn().mockImplementation(() => events.push('lock-stop')),
			release: jest.fn().mockImplementation(async () => events.push('lock-release')),
		};
		const connectionLockService = {
			acquire: jest.fn().mockResolvedValue(connectionLock),
		};
		const service = createBankingService({
			bankConnectionRepository,
			dataSource,
			enableBankingClient: {
				createSession: jest.fn().mockResolvedValue({
					sessionId: 'provider-session',
					consentValidUntil: '2030-01-01T00:00:00.000Z',
					aspsp: {name: 'ABN AMRO', country: 'NL'},
					accounts: [],
				}),
			},
			authorizationStateService,
			encryptionService: {encrypt: jest.fn().mockReturnValue('encrypted-session')},
			connectionLockService,
			bankingSyncQueueService: queueService,
		});

		await expect(service.handleCallback({state: callbackState, code: 'provider-code'})).resolves.toBe('connected');

		expect(transactionConnectionRepository.update).toHaveBeenCalledWith(
			{id: state.connectionId},
			expect.objectContaining({
				status: 'AUTHORIZED',
				nextSyncAt: expect.any(Date),
				syncStatus: 'QUEUED',
			}),
		);
		expect(events).toEqual([
			'transaction-commit',
			'lock-stop',
			'lock-release',
			'lock-stop',
			'lock-release',
			'queue',
		]);
		expect(queueService.enqueueInitialSync).toHaveBeenCalledWith(state.connectionId);
		expect(connectionLockService.acquire).toHaveBeenNthCalledWith(
			1,
			expect.stringMatching(/^authorization:/),
			expect.objectContaining({waitForMs: expect.any(Number)}),
		);
		expect(connectionLockService.acquire).toHaveBeenNthCalledWith(
			2,
			state.connectionId,
			expect.objectContaining({waitForMs: expect.any(Number)}),
		);
	});
});

describe('BankingService findAll', () => {
	/** Chainable query builder double that records calls and resolves `getMany` with the given rows. */
	function createQueryBuilderMock(rows: unknown[]) {
		const queryBuilder = {
			innerJoin: jest.fn().mockReturnThis(),
			addSelect: jest.fn().mockReturnThis(),
			distinctOn: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(),
			addOrderBy: jest.fn().mockReturnThis(),
			getMany: jest.fn().mockResolvedValue(rows),
		};
		return queryBuilder;
	}

	function createBalance(id: string, bankAccountId: string, balanceType: string, amount: string) {
		return {
			id,
			bankAccountId,
			name: null,
			balanceType,
			amount,
			currency: 'EUR',
			lastChangeDateTime: null,
			referenceDate: null,
			observedAt: new Date('2026-01-02T00:00:00.000Z'),
		};
	}

	it('loads accounts and latest balances for every connection in one query each', async () => {
		const connections = [
			{id: 'connection-new', provider: 'enable-banking', aspspName: 'New Bank', aspspCountry: 'NL'},
			{id: 'connection-old', provider: 'enable-banking', aspspName: 'Old Bank', aspspCountry: 'DE'},
			{id: 'connection-empty', provider: 'enable-banking', aspspName: 'Empty Bank', aspspCountry: 'FR'},
		];
		const bankAccounts = [
			{id: 'account-old-1', name: 'Old 1', bankConnection: {id: 'connection-old'}},
			{id: 'account-new-1', name: 'New 1', bankConnection: {id: 'connection-new'}},
			{id: 'account-old-2', name: 'Old 2', bankConnection: {id: 'connection-old'}},
		];
		const balances = [
			createBalance('balance-1', 'account-new-1', 'BOOKED', '10.00000000'),
			createBalance('balance-2', 'account-old-1', 'AVAILABLE', '20.00000000'),
			createBalance('balance-3', 'account-old-1', 'BOOKED', '21.00000000'),
		];
		const connectionQueryBuilder = createQueryBuilderMock(connections);
		const accountQueryBuilder = createQueryBuilderMock(bankAccounts);
		const balanceQueryBuilder = createQueryBuilderMock(balances);
		const bankConnectionRepository = {createQueryBuilder: jest.fn(() => connectionQueryBuilder)};
		const bankAccountRepository = {createQueryBuilder: jest.fn(() => accountQueryBuilder)};
		const bankAccountBalanceRepository = {createQueryBuilder: jest.fn(() => balanceQueryBuilder)};
		const service = createBankingService({
			bankConnectionRepository,
			bankAccountRepository,
			bankAccountBalanceRepository,
		});

		const result = await service.findAll(OWNER);

		expect(bankAccountRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
		expect(bankAccountBalanceRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
		expect(accountQueryBuilder.where).toHaveBeenCalledWith('bankConnection.id IN (:...connectionIds)', {
			connectionIds: ['connection-new', 'connection-old', 'connection-empty'],
		});
		expect(accountQueryBuilder.orderBy).toHaveBeenCalledWith('bankAccount.createdAt', 'ASC');
		expect(balanceQueryBuilder.distinctOn).toHaveBeenCalledWith(['balance.bankAccountId', 'balance.balanceType']);
		expect(balanceQueryBuilder.where).toHaveBeenCalledWith('balance.bankAccountId IN (:...bankAccountIds)', {
			bankAccountIds: ['account-old-1', 'account-new-1', 'account-old-2'],
		});
		expect(balanceQueryBuilder.orderBy).toHaveBeenCalledWith('balance.bankAccountId', 'ASC');
		expect(balanceQueryBuilder.addOrderBy.mock.calls).toEqual([
			['balance.balanceType', 'ASC'],
			['balance.observedAt', 'DESC'],
			['balance.id', 'DESC'],
		]);

		expect(result.map(({id}) => id)).toEqual(['connection-new', 'connection-old', 'connection-empty']);
		expect(result.map(({bankAccounts: accounts}) => accounts.map(({id}) => id))).toEqual([
			['account-new-1'],
			['account-old-1', 'account-old-2'],
			[],
		]);
		expect(result[0].bankAccounts[0].latestBalances).toEqual([
			expect.objectContaining({balanceType: 'BOOKED', amount: '10.00000000', isPrimary: true}),
		]);
		expect(result[1].bankAccounts[0].latestBalances).toEqual([
			expect.objectContaining({balanceType: 'AVAILABLE', amount: '20.00000000', isPrimary: true}),
			expect.objectContaining({balanceType: 'BOOKED', amount: '21.00000000', isPrimary: false}),
		]);
		expect(result[1].bankAccounts[1].latestBalances).toEqual([]);
		expect(result[0].bankAccounts[0]).not.toHaveProperty('bankConnection');
	});

	it('skips account and balance queries when the account has no connections', async () => {
		const bankAccountRepository = {createQueryBuilder: jest.fn()};
		const bankAccountBalanceRepository = {createQueryBuilder: jest.fn()};
		const service = createBankingService({
			bankConnectionRepository: {createQueryBuilder: jest.fn(() => createQueryBuilderMock([]))},
			bankAccountRepository,
			bankAccountBalanceRepository,
		});

		await expect(service.findAll(OWNER)).resolves.toEqual([]);
		expect(bankAccountRepository.createQueryBuilder).not.toHaveBeenCalled();
		expect(bankAccountBalanceRepository.createQueryBuilder).not.toHaveBeenCalled();
	});

	it('skips the balance query when connections have no bank accounts', async () => {
		const bankAccountBalanceRepository = {createQueryBuilder: jest.fn()};
		const service = createBankingService({
			bankConnectionRepository: {
				createQueryBuilder: jest.fn(() => createQueryBuilderMock([{id: 'connection-id'}])),
			},
			bankAccountRepository: {createQueryBuilder: jest.fn(() => createQueryBuilderMock([]))},
			bankAccountBalanceRepository,
		});

		const result = await service.findAll(OWNER);

		expect(result).toEqual([expect.objectContaining({id: 'connection-id', bankAccounts: []})]);
		expect(bankAccountBalanceRepository.createQueryBuilder).not.toHaveBeenCalled();
	});
});
