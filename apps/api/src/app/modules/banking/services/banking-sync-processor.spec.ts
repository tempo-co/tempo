import {Job} from 'bullmq';
import {Repository} from 'typeorm';

import {DISPATCH_BANK_CONNECTION_SYNCS_JOB, SYNC_BANK_CONNECTION_JOB} from '@core/queue/queue.constants';

import {BankConnection} from '../bank-connection.entity';
import {BankingSyncQueueService} from './banking-sync-queue.service';
import {BANK_SYNC_STATUSES} from './banking-sync.constants';
import {BankingSyncProcessor} from './banking-sync.processor';
import {BankingSyncService} from './banking-sync.service';

describe('BankingSyncProcessor', () => {
	let repository: {findOne: jest.Mock};
	let synchronizationService: {synchronizeAutomatically: jest.Mock};
	let queueService: {
		dispatchDueConnections: jest.Mock;
		isIntegrationEnabled: jest.Mock;
		isSynchronizationDue: jest.Mock;
	};
	let processor: BankingSyncProcessor;

	beforeEach(() => {
		repository = {findOne: jest.fn()};
		synchronizationService = {synchronizeAutomatically: jest.fn().mockResolvedValue(undefined)};
		queueService = {
			dispatchDueConnections: jest.fn().mockResolvedValue(0),
			isIntegrationEnabled: jest.fn().mockReturnValue(true),
			isSynchronizationDue: jest.fn().mockReturnValue(false),
		};
		processor = new BankingSyncProcessor(
			repository as unknown as Repository<BankConnection>,
			synchronizationService as unknown as BankingSyncService,
			queueService as unknown as BankingSyncQueueService,
		);
	});

	it('does nothing when the queued connection has been deleted', async () => {
		repository.findOne.mockResolvedValue(null);

		await processor.process(job('missing-connection'));

		expect(synchronizationService.synchronizeAutomatically).not.toHaveBeenCalled();
	});

	it('does nothing while the durable gate is in the future', async () => {
		repository.findOne.mockResolvedValue({
			id: 'future-connection',
			status: 'AUTHORIZED',
			nextSyncAt: new Date(Date.now() + 60_000),
			syncStatus: BANK_SYNC_STATUSES.SUCCEEDED,
		});

		await processor.process(job('future-connection'));

		expect(synchronizationService.synchronizeAutomatically).not.toHaveBeenCalled();
	});

	it('invokes the internal automatic synchronization entry point for an eligible connection', async () => {
		repository.findOne.mockResolvedValue({
			id: 'eligible-connection',
			status: 'AUTHORIZED',
			nextSyncAt: new Date(Date.now() - 1),
			syncStatus: BANK_SYNC_STATUSES.QUEUED,
		});

		queueService.isSynchronizationDue.mockReturnValue(true);
		await processor.process(job('eligible-connection'));

		expect(synchronizationService.synchronizeAutomatically).toHaveBeenCalledWith('eligible-connection');
	});

	it('reprocesses a stale running connection after a worker crash', async () => {
		repository.findOne.mockResolvedValue({
			id: 'stale-connection',
			status: 'AUTHORIZED',
			nextSyncAt: new Date(Date.now() - 1),
			syncStartedAt: new Date(Date.now() - 31 * 60_000),
			syncStatus: BANK_SYNC_STATUSES.RUNNING,
		});

		queueService.isSynchronizationDue.mockReturnValue(true);
		await processor.process(job('stale-connection'));

		expect(synchronizationService.synchronizeAutomatically).toHaveBeenCalledWith('stale-connection');
	});

	it('ignores unrelated job names', async () => {
		repository.findOne.mockResolvedValue({
			id: 'eligible-connection',
			status: 'AUTHORIZED',
			nextSyncAt: new Date(Date.now() - 1),
		});

		await processor.process({name: 'unrelated-job', data: {connectionId: 'eligible-connection'}} as Job);

		expect(repository.findOne).not.toHaveBeenCalled();
		expect(synchronizationService.synchronizeAutomatically).not.toHaveBeenCalled();
	});

	it('does not consume banking jobs when integration is disabled', async () => {
		queueService.isIntegrationEnabled.mockReturnValue(false);

		await processor.process({name: DISPATCH_BANK_CONNECTION_SYNCS_JOB, data: {}} as Job);
		await processor.process(job('connection-id'));

		expect(queueService.dispatchDueConnections).not.toHaveBeenCalled();
		expect(repository.findOne).not.toHaveBeenCalled();
		expect(synchronizationService.synchronizeAutomatically).not.toHaveBeenCalled();
	});
});

function job(connectionId: string): Job {
	return {name: SYNC_BANK_CONNECTION_JOB, data: {connectionId}} as Job;
}
