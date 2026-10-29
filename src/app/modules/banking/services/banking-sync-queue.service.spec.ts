import {Queue} from 'bullmq';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {
	BANK_CONNECTION_SYNC_QUEUE,
	BANK_CONNECTION_SYNC_SCHEDULER_ID,
	DISPATCH_BANK_CONNECTION_SYNCS_JOB,
	SYNC_BANK_CONNECTION_JOB,
} from '@core/queue/queue.constants';

import {BankConnection} from '../bank-connection.entity';
import {BankingSyncQueueService} from './banking-sync-queue.service';
import {BANK_SYNC_STATUSES} from './banking-sync.constants';

type QueueMock = {
	add: jest.Mock;
	getJob: jest.Mock;
	upsertJobScheduler: jest.Mock;
};

describe('BankingSyncQueueService', () => {
	let bankConnectionRepository: {createQueryBuilder: jest.Mock; update: jest.Mock};
	let queue: QueueMock;
	let connectionLockService: {isHeld: jest.Mock};
	let service: BankingSyncQueueService;

	beforeEach(() => {
		queue = {
			add: jest.fn().mockResolvedValue(undefined),
			getJob: jest.fn().mockResolvedValue(null),
			upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
		};
		bankConnectionRepository = {
			createQueryBuilder: jest.fn(),
			update: jest.fn().mockResolvedValue({affected: 1}),
		};
		connectionLockService = {isHeld: jest.fn().mockResolvedValue(false)};
		service = new BankingSyncQueueService(
			bankConnectionRepository as unknown as Repository<BankConnection>,
			queue as unknown as Queue,
			{get: jest.fn().mockReturnValue('10m')} as unknown as ConfigurationService,
			connectionLockService as never,
		);
	});

	it('enqueues only authorized connections whose durable gate is due', async () => {
		const dueConnection = {
			id: 'due-connection',
			status: 'AUTHORIZED',
			nextSyncAt: new Date(Date.now() - 1),
			syncStatus: BANK_SYNC_STATUSES.SUCCEEDED,
		} as BankConnection;
		const futureConnection = {
			id: 'future-connection',
			status: 'AUTHORIZED',
			nextSyncAt: new Date(Date.now() + 60_000),
		} as BankConnection;
		const pendingConnection = {
			id: 'pending-connection',
			status: 'PENDING_AUTHORIZATION',
			nextSyncAt: new Date(Date.now() - 1),
		} as BankConnection;
		const queryBuilder = {
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(),
			addOrderBy: jest.fn().mockReturnThis(),
			take: jest.fn().mockReturnThis(),
			getMany: jest.fn().mockResolvedValue([dueConnection, futureConnection, pendingConnection]),
		};
		bankConnectionRepository.createQueryBuilder.mockReturnValue(queryBuilder);

		await service.dispatchDueConnections(new Date());

		expect(queue.add).toHaveBeenCalledTimes(1);
		expect(queue.add).toHaveBeenCalledWith(
			SYNC_BANK_CONNECTION_JOB,
			{connectionId: dueConnection.id},
			expect.objectContaining({jobId: expect.stringContaining(dueConnection.id), attempts: 1}),
		);
		expect(queue.add).not.toHaveBeenCalledWith(
			SYNC_BANK_CONNECTION_JOB,
			expect.objectContaining({connectionId: futureConnection.id}),
			expect.anything(),
		);
		expect(queryBuilder.where).toHaveBeenCalledWith('connection.status = :status', {status: 'AUTHORIZED'});
		expect(queryBuilder.andWhere).toHaveBeenCalledWith(
			'(connection.nextSyncAt <= :now OR (connection.syncStatus = :running AND connection.syncStartedAt <= :staleBefore))',
			expect.objectContaining({running: BANK_SYNC_STATUSES.RUNNING, staleBefore: expect.any(Date)}),
		);
		expect(bankConnectionRepository.update).toHaveBeenCalledWith(
			{
				id: dueConnection.id,
				status: 'AUTHORIZED',
				nextSyncAt: expect.anything(),
				syncStatus: expect.anything(),
			},
			expect.objectContaining({syncStatus: BANK_SYNC_STATUSES.QUEUED}),
		);
	});

	it('does not requeue a stale-looking run while its Redis lease is held', async () => {
		const staleConnection = {
			id: 'stale-connection',
			status: 'AUTHORIZED',
			nextSyncAt: new Date(Date.now() - 60_000),
			syncStatus: BANK_SYNC_STATUSES.RUNNING,
			syncStartedAt: new Date(Date.now() - 31 * 60_000),
		} as BankConnection;
		const queryBuilder = {
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(),
			addOrderBy: jest.fn().mockReturnThis(),
			take: jest.fn().mockReturnThis(),
			getMany: jest.fn().mockResolvedValue([staleConnection]),
		};
		bankConnectionRepository.createQueryBuilder.mockReturnValue(queryBuilder);
		connectionLockService.isHeld.mockResolvedValue(true);

		await service.dispatchDueConnections(new Date());

		expect(connectionLockService.isHeld).toHaveBeenCalledWith(staleConnection.id);
		expect(queue.add).not.toHaveBeenCalled();
		expect(bankConnectionRepository.update).not.toHaveBeenCalled();
	});

	it('does not add an overlapping job when the deterministic job is already waiting', async () => {
		const existingJob = {getState: jest.fn().mockResolvedValue('waiting')};
		queue.getJob.mockResolvedValue(existingJob);

		await service.enqueueInitialSync('connection-id');

		expect(queue.getJob).toHaveBeenCalledWith(expect.stringContaining('connection-id'));
		expect(queue.add).not.toHaveBeenCalled();
	});

	it('installs one stable dispatcher scheduler outside test mode', async () => {
		await service.onModuleInit();

		expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({every: 600_000}),
			expect.objectContaining({name: DISPATCH_BANK_CONNECTION_SYNCS_JOB}),
		);
	});

	it('uses the automatic sync queue name for the dispatcher and connection jobs', () => {
		expect(BANK_CONNECTION_SYNC_QUEUE).toBe('bank-connection-sync');
	});

	describe('with banking integration disabled', () => {
		function createDisabledService(removeJobScheduler: jest.Mock) {
			const disabledQueue = {...queue, removeJobScheduler};
			const disabledService = new BankingSyncQueueService(
				bankConnectionRepository as unknown as Repository<BankConnection>,
				disabledQueue as unknown as Queue,
				{
					get: jest.fn((key: string) => {
						if (key === 'BANKING_INTEGRATION_ENABLED') return false;
						if (key === 'NODE_ENV') return 'production';
						return '10m';
					}),
				} as unknown as ConfigurationService,
				connectionLockService as never,
			);
			return disabledService;
		}

		it('does not schedule or enqueue banking work', async () => {
			const removeJobScheduler = jest.fn().mockResolvedValue(false);
			const disabledService = createDisabledService(removeJobScheduler);

			await disabledService.onModuleInit();
			await disabledService.enqueueInitialSync('connection-id');
			await expect(disabledService.dispatchDueConnections()).resolves.toBe(0);

			expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
			expect(removeJobScheduler).toHaveBeenCalledWith(BANK_CONNECTION_SYNC_SCHEDULER_ID);
			expect(queue.add).not.toHaveBeenCalled();
			expect(bankConnectionRepository.createQueryBuilder).not.toHaveBeenCalled();
		});
	});
});
