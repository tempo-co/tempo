import {DataSource} from 'typeorm';

import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import {applyOwnTransferCategories} from '../own-transfer/own-transfer-category';
import {recomputeOwnTransfers} from '../own-transfer/own-transfer-recompute';
import {OwnTransferService} from './own-transfer.service';

jest.mock('../own-transfer/own-transfer-recompute', () => ({
	...jest.requireActual('../own-transfer/own-transfer-recompute'),
	recomputeOwnTransfers: jest.fn(),
}));
jest.mock('../own-transfer/own-transfer-category', () => ({
	...jest.requireActual('../own-transfer/own-transfer-category'),
	applyOwnTransferCategories: jest.fn(),
}));

describe('OwnTransferService', () => {
	const recompute = jest.mocked(recomputeOwnTransfers);
	const applyCategories = jest.mocked(applyOwnTransferCategories);
	// The override update finds its row; everything else the manager runs is mocked out.
	const manager = {query: jest.fn().mockResolvedValue([[{id: 'overridden-id'}], 1])};
	let service: OwnTransferService;

	beforeEach(() => {
		recompute.mockReset().mockResolvedValue({accountIbansAdded: 0, transactionsChanged: 0, changedIds: []});
		applyCategories.mockReset().mockResolvedValue([]);
		// Transactions run one at a time, as the owner lock serializes them, and a failed one frees the lock before its
		// caller hears of the failure, as when the database ends the session.
		let tail: Promise<unknown> = Promise.resolve();
		const dataSource = {
			transaction: jest.fn((work: (manager: unknown) => Promise<unknown>) => {
				const run = tail.then(() => work(manager));
				tail = run.catch(() => undefined);
				return run.catch(async (error: unknown) => {
					await new Promise(setImmediate);
					throw error;
				});
			}),
		};
		service = new OwnTransferService(
			dataSource as unknown as DataSource,
			{enqueueForTransactions: jest.fn()} as unknown as CategorizationScheduler,
		);
	});

	it('recomputes the whole history before an owner’s first scoped recompute and after a failed one', async () => {
		// Nothing vouches for the stored state yet (a fresh process): the first recompute covers everything.
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: []});
		expect(recompute).toHaveBeenLastCalledWith(manager, 'owner-id', undefined);
		expect(applyCategories).toHaveBeenLastCalledWith(manager, 'owner-id', undefined);
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: []});
		expect(recompute).toHaveBeenCalledTimes(1);

		// Categories follow the changed rows and the rows whose evidence changed.
		recompute.mockResolvedValueOnce({accountIbansAdded: 0, transactionsChanged: 1, changedIds: ['partner-id']});
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: ['changed-id']});
		expect(recompute).toHaveBeenLastCalledWith(manager, 'owner-id', {transactionIds: ['changed-id']});
		expect(applyCategories).toHaveBeenLastCalledWith(manager, 'owner-id', ['changed-id', 'partner-id']);

		// The rows a failed run missed are unknown, so the next run covers everything, even with nothing new.
		recompute.mockRejectedValueOnce(new Error('deadlock detected'));
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: ['next-id']});
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: []});
		expect(recompute).toHaveBeenLastCalledWith(manager, 'owner-id', undefined);
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: ['later-id']});
		expect(recompute).toHaveBeenLastCalledWith(manager, 'owner-id', {transactionIds: ['later-id']});

		// A write whose commit outcome is unknown asks for the whole history too.
		service.requireWholeHistory('owner-id');
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: ['unknown-id']});
		expect(recompute).toHaveBeenLastCalledWith(manager, 'owner-id', undefined);
	});

	it('recomputes the whole history when a recompute it waited for failed', async () => {
		await service.recomputeForOwnerSafely('owner-id');
		recompute.mockRejectedValueOnce(new Error('deadlock detected'));

		await Promise.all([
			service.recomputeForOwnerSafely('owner-id', {transactionIds: ['first-id']}),
			service.recomputeForOwnerSafely('owner-id', {transactionIds: ['second-id']}),
		]);

		expect(recompute).toHaveBeenNthCalledWith(2, manager, 'owner-id', {transactionIds: ['first-id']});
		expect(recompute).toHaveBeenNthCalledWith(3, manager, 'owner-id', undefined);
	});

	it('recomputes an override in scope only for an owner in step', async () => {
		await expect(service.updateOverride('owner-id', 'overridden-id', 'MARKED')).resolves.toBe(true);
		expect(recompute).toHaveBeenLastCalledWith(manager, 'owner-id', undefined);

		await expect(service.updateOverride('owner-id', 'overridden-id', null)).resolves.toBe(true);
		expect(recompute).toHaveBeenLastCalledWith(manager, 'owner-id', {transactionIds: ['overridden-id']});
		expect(applyCategories).toHaveBeenLastCalledWith(manager, 'owner-id', ['overridden-id']);
	});
});
