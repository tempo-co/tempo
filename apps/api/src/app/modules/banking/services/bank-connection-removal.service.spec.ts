import {BankConnection} from '../bank-connection.entity';
import {BankConnectionRemovalService} from './bank-connection-removal.service';

const BANK_CONNECTION_REMOVAL_SERVICE_DEPENDENCIES = [
	'bankConnectionRepository',
	'bankAccountRepository',
	'dataSource',
	'authorizationStateService',
	'connectionLockService',
	'ownTransferService',
	'consentRevocationService',
	'reportingCurrencyService',
] as const;

const DEFAULT_DEPENDENCIES: Partial<Record<string, unknown>> = {
	reportingCurrencyService: {reconcileSafely: jest.fn().mockResolvedValue(undefined)},
	ownTransferService: {recomputeForOwnerSafely: jest.fn().mockResolvedValue(undefined)},
	consentRevocationService: {revokeSessions: jest.fn().mockResolvedValue(undefined)},
};

/** Builds the service with named test doubles; unspecified dependencies are empty objects. */
function createBankConnectionRemovalService(
	dependencies: Partial<Record<(typeof BANK_CONNECTION_REMOVAL_SERVICE_DEPENDENCIES)[number], unknown>> = {},
): BankConnectionRemovalService {
	return new BankConnectionRemovalService(
		...(BANK_CONNECTION_REMOVAL_SERVICE_DEPENDENCIES.map(
			(name) => dependencies[name] ?? DEFAULT_DEPENDENCIES[name] ?? {},
		) as ConstructorParameters<typeof BankConnectionRemovalService>),
	);
}

describe('BankConnectionRemovalService', () => {
	it('does not acquire the mutation lock before ownership is confirmed', async () => {
		const bankConnectionRepository = {
			findOne: jest.fn().mockResolvedValue(null),
		};
		const connectionLockService = {
			acquire: jest.fn(),
		};
		const service = createBankConnectionRemovalService({
			bankConnectionRepository,
			connectionLockService,
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
		const service = createBankConnectionRemovalService({
			bankConnectionRepository,
			dataSource,
			connectionLockService,
		});

		await expect(service.removeConnection('owner-account-id', connection.id, 'DELETE')).rejects.toThrow(
			'deletion failed',
		);
		expect(connectionLockService.acquire).toHaveBeenCalledWith(connection.id);
		expect(connectionLock.stop).toHaveBeenCalledTimes(1);
		expect(connectionLock.release).toHaveBeenCalledTimes(1);
	});

	it('revokes the bank consent before deletion and cleans all affected authorization states once after it commits', async () => {
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
			removeForConnections: jest.fn().mockImplementation(async () => {
				events.push('cleanup');
				return 3;
			}),
		};
		const consentRevocationService = {
			revokeSessions: jest.fn().mockImplementation(async () => {
				events.push('revoke');
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
		const service = createBankConnectionRemovalService({
			bankConnectionRepository,
			dataSource,
			authorizationStateService,
			connectionLockService,
			consentRevocationService,
		});

		await service.removeConnection('account-id', connection.id, 'DELETE');

		expect(events).toEqual(['revoke', 'transaction-start', 'transaction-commit', 'cleanup']);
		expect(consentRevocationService.revokeSessions).toHaveBeenCalledWith([connection]);
		expect(authorizationStateService.removeForConnections).toHaveBeenCalledTimes(1);
		expect(authorizationStateService.removeForConnections).toHaveBeenCalledWith([
			'authorized-connection',
			'pending-connection-one',
			'pending-connection-two',
		]);
	});
});
