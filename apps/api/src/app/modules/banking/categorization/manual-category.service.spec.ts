import {APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB} from '@core/queue/queue.constants';

import {createBankTransaction} from '../../../../../test/fixtures/bank-transaction.fixture';
import {
	createCategorizationServices,
	createUpdateQueryBuilder,
} from '../../../../../test/fixtures/categorization-services.fixture';

describe('ManualCategoryService follow-up', () => {
	const transaction = () =>
		createBankTransaction({id: 'corrected', merchantKey: 'EXPENSE:example shop', categorySource: 'AI'});
	const selected = ['sibling-1', 'sibling-2'];

	it('queues a retry when applying a correction to the same merchant fails', async () => {
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockRejectedValueOnce(new Error('connection lost'));
		const {manualCategories, queue} = createCategorizationServices({queryBuilder});

		await expect(
			manualCategories.setManualCategory('account-1', transaction(), 'SHOPPING', selected),
		).resolves.toBe(true);

		expect(queue.add).toHaveBeenCalledTimes(1);
		const [name, data, opts] = queue.add.mock.calls[0];
		expect(name).toBe(APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB);
		// The retry keeps the owner's selection, so it can never widen to rows they left out.
		expect(data).toEqual({accountId: 'account-1', merchantKey: 'EXPENSE:example shop', transactionIds: selected});
		expect(opts).toMatchObject({attempts: 8});
		// No fixed job id: a retained failed or running job with the same id would swallow this one.
		expect(opts).not.toHaveProperty('jobId');
	});

	it('does not hold the request open while Redis is unreachable', async () => {
		jest.useFakeTimers();
		try {
			const queryBuilder = createUpdateQueryBuilder();
			queryBuilder.getRawMany.mockRejectedValueOnce(new Error('connection lost'));
			const {manualCategories, queue} = createCategorizationServices({queryBuilder});
			queue.add.mockReturnValueOnce(new Promise(() => undefined));

			const saved = manualCategories.setManualCategory('account-1', transaction(), 'SHOPPING', selected);
			await jest.advanceTimersByTimeAsync(2_000);

			await expect(saved).resolves.toBe(true);
		} finally {
			jest.useRealTimers();
		}
	});

	it.each([
		['nothing is selected', []],
		['only the corrected row is selected', ['corrected']],
	])('changes no other row when %s', async (_, ids) => {
		const queryBuilder = createUpdateQueryBuilder();
		const {manualCategories, queue, repository} = createCategorizationServices({queryBuilder});

		await expect(manualCategories.setManualCategory('account-1', transaction(), 'SHOPPING', ids)).resolves.toBe(
			true,
		);

		expect(repository.update).toHaveBeenCalledTimes(1);
		expect(repository.createQueryBuilder).not.toHaveBeenCalled();
		expect(queue.add).not.toHaveBeenCalled();
	});

	it('limits the follow-up to the selected rows and queues no retry', async () => {
		const queryBuilder = createUpdateQueryBuilder([{affected: 2}], [{id: 'manual'}]);
		queryBuilder.getRawMany.mockResolvedValueOnce([
			{merchantKey: 'EXPENSE:example shop', category: 'SHOPPING', count: 1},
		]);
		const {manualCategories, queue} = createCategorizationServices({queryBuilder});

		await manualCategories.setManualCategory('account-1', transaction(), 'SHOPPING', [...selected, 'sibling-1']);

		expect(queryBuilder.andWhere).toHaveBeenCalledWith('id IN (:...followUpTransactionIds)', {
			followUpTransactionIds: selected,
		});
		expect(queryBuilder.set).toHaveBeenCalledWith(
			expect.objectContaining({category: 'SHOPPING', categorySource: 'HISTORY', categoryStatus: 'COMPLETED'}),
		);
		expect(queue.add).not.toHaveBeenCalled();
	});

	it('keeps the manual category when the retry cannot be queued either', async () => {
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockRejectedValueOnce(new Error('connection lost'));
		const {manualCategories, queue, repository} = createCategorizationServices({queryBuilder});
		queue.add.mockRejectedValueOnce(new Error('redis down'));

		await expect(
			manualCategories.setManualCategory('account-1', transaction(), 'SHOPPING', selected),
		).resolves.toBe(true);
		expect(repository.update).toHaveBeenCalledWith(
			{id: 'corrected'},
			expect.objectContaining({category: 'SHOPPING', categorySource: 'MANUAL'}),
		);
	});

	it('lets a failing queued follow-up throw so the queue retries it', async () => {
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockRejectedValueOnce(new Error('connection lost'));
		const {manualCategories} = createCategorizationServices({queryBuilder});

		await expect(
			manualCategories.processManualCategoryFollowUp({
				accountId: 'account-1',
				merchantKey: 'EXPENSE:example shop',
				transactionIds: selected,
			}),
		).rejects.toThrow('connection lost');
	});
});
