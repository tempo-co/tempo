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
	let dataSource: {transaction: jest.Mock; query: jest.Mock};
	let service: OwnTransferService;

	beforeEach(() => {
		recompute.mockReset().mockResolvedValue({accountIbansAdded: 0, transactionsChanged: 0, changedIds: []});
		applyCategories.mockReset().mockResolvedValue([]);
		dataSource = {
			transaction: jest.fn((work: (manager: unknown) => Promise<unknown>) => work(manager)),
			query: jest.fn(),
		};
		service = new OwnTransferService(
			dataSource as unknown as DataSource,
			{enqueueForTransactions: jest.fn()} as unknown as CategorizationScheduler,
		);
	});

	it('recomputes in scope, and does nothing for an empty scope', async () => {
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: []});
		expect(dataSource.transaction).not.toHaveBeenCalled();

		// Categories follow the scoped rows and the rows whose evidence changed.
		recompute.mockResolvedValueOnce({accountIbansAdded: 0, transactionsChanged: 1, changedIds: ['partner-id']});
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: ['changed-id']});
		expect(recompute).toHaveBeenCalledWith(manager, 'owner-id', {transactionIds: ['changed-id']});
		expect(applyCategories).toHaveBeenCalledWith(manager, 'owner-id', ['changed-id', 'partner-id']);
	});

	it('retries a failed scoped recompute over the whole history, and a failed whole-history one not at all', async () => {
		recompute.mockRejectedValueOnce(new Error('deadlock detected'));
		await service.recomputeForOwnerSafely('owner-id', {transactionIds: ['changed-id']});
		expect(recompute.mock.calls).toEqual([
			[manager, 'owner-id', {transactionIds: ['changed-id']}],
			[manager, 'owner-id', undefined],
		]);
		expect(applyCategories).toHaveBeenLastCalledWith(manager, 'owner-id', undefined);

		recompute.mockClear().mockRejectedValue(new Error('deadlock detected'));
		await expect(service.recomputeForOwnerSafely('owner-id')).resolves.toBeUndefined();
		expect(recompute).toHaveBeenCalledTimes(1);
	});

	it('recomputes the whole history after an override', async () => {
		await expect(service.updateOverride('owner-id', 'overridden-id', 'MARKED')).resolves.toBe(true);
		expect(recompute).toHaveBeenCalledWith(manager, 'owner-id');
		expect(applyCategories).toHaveBeenCalledWith(manager, 'owner-id');
	});

	it('recomputes every owner over the whole history, one failure not stopping the rest', async () => {
		dataSource.query.mockResolvedValue([{accountId: 'first-owner'}, {accountId: 'second-owner'}]);
		recompute.mockRejectedValueOnce(new Error('deadlock detected'));

		await service.recomputeAllOwners();

		expect(recompute.mock.calls.map(([, ownerId, scope]) => [ownerId, scope])).toEqual([
			['first-owner', undefined],
			['second-owner', undefined],
		]);
	});
});
