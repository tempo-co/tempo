import {Job} from 'bullmq';

import {
	APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
	RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB,
} from '@core/queue/queue.constants';

import {BankTransactionCategorizationProcessor} from './bank-transaction-categorization.processor';
import {
	BankTransactionCategorizationJobData,
	BankTransactionCategorizationQueueData,
	BankTransactionCategorizationService,
} from './bank-transaction-categorization.service';

describe('BankTransactionCategorizationProcessor', () => {
	it('forwards only transaction IDs to the categorization service', async () => {
		const service = {
			processTransactionJob: jest.fn().mockResolvedValue(undefined),
		};
		const processor = new BankTransactionCategorizationProcessor(
			service as unknown as BankTransactionCategorizationService,
		);
		const job = {
			name: CATEGORIZE_BANK_TRANSACTIONS_JOB,
			data: {transactionIds: ['transaction-id']},
		} as unknown as Job<BankTransactionCategorizationJobData>;

		await processor.process(job);

		expect(service.processTransactionJob).toHaveBeenCalledWith(['transaction-id']);
	});

	it('routes follow-up and reconciliation jobs', async () => {
		const service = {
			processManualCategoryFollowUp: jest.fn().mockResolvedValue(undefined),
			reconcilePendingTransactions: jest.fn().mockResolvedValue(undefined),
		};
		const processor = new BankTransactionCategorizationProcessor(
			service as unknown as BankTransactionCategorizationService,
		);
		const followUp = {accountId: 'account-1', merchantKey: 'EXPENSE:example shop'};

		await processor.process({
			name: APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB,
			data: followUp,
		} as unknown as Job<BankTransactionCategorizationQueueData>);
		await processor.process({
			name: RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB,
			data: {},
		} as unknown as Job<BankTransactionCategorizationQueueData>);

		expect(service.processManualCategoryFollowUp).toHaveBeenCalledWith(followUp);
		expect(service.reconcilePendingTransactions).toHaveBeenCalledWith({includeFailed: false});
	});
});
