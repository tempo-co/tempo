import {BankTransactionCategorizationService} from '../categorization/bank-transaction-categorization.service';
import {BankingSyncService} from './banking-sync.service';

type TestableSyncService = {
	persistSync: jest.Mock;
	enqueuePersistedTransactions: (ids: readonly string[]) => Promise<void>;
	categorizationService: BankTransactionCategorizationService;
	logger: {warn: jest.Mock};
};

describe('BankingSyncService categorization scheduling', () => {
	it('schedules persisted transaction IDs only after the source transaction commits', async () => {
		const order: string[] = [];
		const categorizationService = {
			enqueueForTransactions: jest.fn(async () => {
				order.push('enqueue');
			}),
		};
		const service = Object.create(BankingSyncService.prototype) as unknown as TestableSyncService;
		service.categorizationService = categorizationService as never;
		service.logger = {warn: jest.fn()};
		service.persistSync = jest.fn(async () => {
			order.push('persist');
			return {transactionsAdded: 1, persistedTransactionIds: ['transaction-id']};
		});

		const persisted = await service.persistSync();
		await service.enqueuePersistedTransactions(persisted.persistedTransactionIds);

		expect(order).toEqual(['persist', 'enqueue']);
		expect(categorizationService.enqueueForTransactions).toHaveBeenCalledWith(['transaction-id']);
	});

	it('does not propagate queue failures after persistence succeeds', async () => {
		const categorizationService = {
			enqueueForTransactions: jest.fn().mockRejectedValue(new Error('redis unavailable')),
		};
		const service = Object.create(BankingSyncService.prototype) as unknown as TestableSyncService;
		service.categorizationService = categorizationService as never;
		service.logger = {warn: jest.fn()};

		await expect(service.enqueuePersistedTransactions(['transaction-id'])).resolves.toBeUndefined();
		expect(service.logger.warn).toHaveBeenCalled();
	});
});
