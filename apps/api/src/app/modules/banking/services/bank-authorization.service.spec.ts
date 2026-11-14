import {createHash} from 'node:crypto';

import {BANKING_SERVICE_UNAVAILABLE} from '../api/constants/banking-messages.constants';
import {BankConnection} from '../bank-connection.entity';
import {BankAuthorizationService} from './bank-authorization.service';

function hashState(state: string): string {
	return createHash('sha256').update(state).digest('hex');
}

const BANK_AUTHORIZATION_SERVICE_DEPENDENCIES = [
	'bankConnectionRepository',
	'accountService',
	'configurationService',
	'dataSource',
	'enableBankingClient',
	'aspspCatalogService',
	'authorizationStateService',
	'encryptionService',
	'connectionLockService',
	'bankingSyncQueueService',
	'ownTransferService',
	'reportingCurrencyService',
] as const;

const DEFAULT_DEPENDENCIES: Partial<Record<string, unknown>> = {
	reportingCurrencyService: {reconcileSafely: jest.fn().mockResolvedValue(undefined)},
	ownTransferService: {recomputeForOwnerSafely: jest.fn().mockResolvedValue(undefined)},
};

/** Builds the service with named test doubles; unspecified dependencies are empty objects. */
function createBankAuthorizationService(
	dependencies: Partial<Record<(typeof BANK_AUTHORIZATION_SERVICE_DEPENDENCIES)[number], unknown>> = {},
): BankAuthorizationService {
	return new BankAuthorizationService(
		...(BANK_AUTHORIZATION_SERVICE_DEPENDENCIES.map(
			(name) => dependencies[name] ?? DEFAULT_DEPENDENCIES[name] ?? {},
		) as ConstructorParameters<typeof BankAuthorizationService>),
	);
}

describe('BankAuthorizationService disabled integration', () => {
	it('blocks provider authorization and callback state consumption when disabled', async () => {
		const bankConnectionRepository = {findOne: jest.fn(), save: jest.fn()};
		const enableBankingClient = {startAuthorization: jest.fn()};
		const aspspCatalogService = {getAspsps: jest.fn()};
		const authorizationStateService = {consumeWithStatus: jest.fn()};
		const service = createBankAuthorizationService({
			bankConnectionRepository,
			configurationService: {
				get: jest.fn((key: string) => (key === 'BANKING_INTEGRATION_ENABLED' ? false : undefined)),
			},
			enableBankingClient,
			aspspCatalogService,
			authorizationStateService,
		});

		await expect(
			service.startAuthorization('account-id', {aspspName: 'Example Bank', aspspCountry: 'NL'} as never),
		).rejects.toMatchObject({status: 503, message: BANKING_SERVICE_UNAVAILABLE});
		await expect(service.handleCallback({state: 'state', code: 'code'})).resolves.toBe('error');

		expect(bankConnectionRepository.findOne).not.toHaveBeenCalled();
		expect(bankConnectionRepository.save).not.toHaveBeenCalled();
		expect(aspspCatalogService.getAspsps).not.toHaveBeenCalled();
		expect(enableBankingClient.startAuthorization).not.toHaveBeenCalled();
		expect(authorizationStateService.consumeWithStatus).not.toHaveBeenCalled();
	});
});

describe('BankAuthorizationService authorization state lifecycle', () => {
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
		const service = createBankAuthorizationService({
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
		const service = createBankAuthorizationService({
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
		const service = createBankAuthorizationService({
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
