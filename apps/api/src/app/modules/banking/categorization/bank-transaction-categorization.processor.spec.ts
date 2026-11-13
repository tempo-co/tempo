import {Job} from 'bullmq';

import {
	APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
	RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB,
} from '@core/queue/queue.constants';

import {BankTransactionCategorizationProcessor} from './bank-transaction-categorization.processor';
import {CategorizationPipeline} from './categorization-pipeline.service';
import {
	BankTransactionCategorizationJobData,
	BankTransactionCategorizationQueueData,
	CategorizationScheduler,
} from './categorization-scheduler.service';
import {ManualCategoryService} from './manual-category.service';

describe('BankTransactionCategorizationProcessor', () => {
	it('forwards only transaction IDs to the categorization service', async () => {
		const service = {
			processTransactionJob: jest.fn().mockResolvedValue(undefined),
		};
		const processor = new BankTransactionCategorizationProcessor(
			service as unknown as CategorizationPipeline,
			{} as ManualCategoryService,
			{} as CategorizationScheduler,
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
			{} as CategorizationPipeline,
			service as unknown as ManualCategoryService,
			service as unknown as CategorizationScheduler,
		);
		const followUp = {accountId: 'account-1', merchantKey: 'EXPENSE:example shop', transactionIds: ['sibling-1']};

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
