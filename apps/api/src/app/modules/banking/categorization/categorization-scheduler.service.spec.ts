import {
	BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE,
	BANK_TRANSACTION_CATEGORIZATION_QUEUE,
	BANK_TRANSACTION_CATEGORIZATION_RECONCILE_SCHEDULER_ID,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
	RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB,
} from '@core/queue/queue.constants';

import {createBankTransaction} from '../../../../../test/fixtures/bank-transaction.fixture';
import {
	createCategorizationServices,
	createUpdateQueryBuilder,
} from '../../../../../test/fixtures/categorization-services.fixture';
import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import {
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from './bank-transaction-categorization.provider';
import {CATEGORIZATION_RETRY_BACKOFF_TYPE, categorizationRetryDelay} from './categorization-scheduler.service';

describe('CategorizationScheduler queue scheduling', () => {
	it('deduplicates transaction IDs and enqueues deterministic batches of 50', async () => {
		const {scheduler, queue} = createCategorizationServices();
		const ids = Array.from(
			{length: BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE + 1},
			(_, index) => `transaction-${index}`,
		);

		await scheduler.enqueueForTransactions([...ids, ids[0]]);

		expect(queue.addBulk).toHaveBeenCalledTimes(1);
		const jobs = queue.addBulk.mock.calls[0][0];
		expect(jobs).toHaveLength(2);
		expect(jobs[0]).toEqual({
			name: CATEGORIZE_BANK_TRANSACTIONS_JOB,
			data: {transactionIds: expect.any(Array)},
			opts: {
				jobId: expect.any(String),
				attempts: 6,
				backoff: {type: CATEGORIZATION_RETRY_BACKOFF_TYPE},
				removeOnFail: true,
			},
		});
		expect(jobs[1]).toEqual({
			name: CATEGORIZE_BANK_TRANSACTIONS_JOB,
			data: {transactionIds: expect.any(Array)},
			opts: {
				jobId: expect.any(String),
				attempts: 6,
				backoff: {type: CATEGORIZATION_RETRY_BACKOFF_TYPE},
				removeOnFail: true,
			},
		});
		expect(jobs[0].data.transactionIds).toHaveLength(50);
		expect(jobs[1].data.transactionIds).toHaveLength(1);
		expect([...jobs[0].data.transactionIds, ...jobs[1].data.transactionIds].sort()).toEqual(ids.sort());
	});

	it.each([
		{attempt: 1, error: new BankTransactionCategorizationUnavailableError(), delay: 60_000},
		{attempt: 2, error: new BankTransactionCategorizationUnavailableError(), delay: 120_000},
		{attempt: 3, error: new BankTransactionCategorizationUnavailableError(), delay: 300_000},
		{attempt: 4, error: new BankTransactionCategorizationUnavailableError(), delay: 600_000},
		{attempt: 5, error: new BankTransactionCategorizationUnavailableError(), delay: 1_200_000},
		{attempt: 1, error: new BankTransactionCategorizationProviderError('synthetic 503', true), delay: 1_000},
		{attempt: 2, error: new BankTransactionCategorizationProviderError('synthetic 503', true), delay: 2_000},
		{attempt: 3, error: new BankTransactionCategorizationProviderError('synthetic 503', true), delay: -1},
		{attempt: 1, error: new Error('synthetic database error'), delay: 1_000},
		{attempt: 3, error: new Error('synthetic database error'), delay: -1},
	])(
		'retries failed attempt $attempt of a categorize job ($error.name) after $delay ms',
		({attempt, error, delay}) => {
			expect(categorizationRetryDelay(attempt, error)).toBe(delay);
		},
	);

	it('changes the job ID when the categorization input hash changes', async () => {
		const transaction = createBankTransaction({categoryInputHash: 'hash-a'});
		const {scheduler, queue} = createCategorizationServices({rows: [transaction]});

		await scheduler.enqueueForTransactions([transaction.id]);
		transaction.categoryInputHash = 'hash-b';
		await scheduler.enqueueForTransactions([transaction.id]);

		expect(queue.addBulk).toHaveBeenCalledTimes(2);
		expect(queue.addBulk.mock.calls[0][0][0].opts.jobId).not.toBe(queue.addBulk.mock.calls[1][0][0].opts.jobId);
	});

	it('does not enqueue when AI categorization is disabled or IDs are empty', async () => {
		const disabled = createCategorizationServices({enabled: false});
		await disabled.scheduler.enqueueForTransactions(['transaction-1']);
		await disabled.scheduler.enqueueForTransactions([]);

		expect(disabled.queue.addBulk).not.toHaveBeenCalled();
		expect(BANK_TRANSACTION_CATEGORIZATION_QUEUE).toBe('bank-transaction-categorization');
	});

	it('does not enqueue financial-event rows for AI categorization', async () => {
		const exchange = createBankTransaction({
			id: 'exchange-transaction',
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		});
		const ordinary = createBankTransaction({id: 'ordinary-transaction'});
		const {scheduler, queue} = createCategorizationServices({rows: [exchange, ordinary]});

		await scheduler.enqueueForTransactions([exchange.id, ordinary.id]);

		expect(queue.addBulk).toHaveBeenCalledTimes(1);
		expect(queue.addBulk.mock.calls[0][0]).toHaveLength(1);
		expect(queue.addBulk.mock.calls[0][0][0].data).toEqual({transactionIds: [ordinary.id]});
	});
});

describe('CategorizationScheduler reconciliation', () => {
	it('does not enqueue financial-event rows found by reconciliation', async () => {
		const exchange = createBankTransaction({
			id: 'reconciled-exchange-transaction',
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		});
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockResolvedValueOnce([{id: exchange.id}]);
		const {scheduler, queue} = createCategorizationServices({
			rows: [exchange],
			webSearchEnabled: true,
			queryBuilder,
		});

		await scheduler.reconcilePendingTransactions();

		expect(queryBuilder.getRawMany).toHaveBeenCalledTimes(1);
		expect(queue.addBulk).not.toHaveBeenCalled();
	});
});

describe('CategorizationScheduler reconciliation schedule', () => {
	it('schedules hourly reconciliation and starts a sweep including FAILED rows without holding up boot', async () => {
		const queryBuilder = createUpdateQueryBuilder();
		queryBuilder.getRawMany.mockReturnValue(new Promise(() => undefined));
		const {scheduler, queue} = createCategorizationServices({nodeEnv: 'production', queryBuilder});

		await scheduler.onApplicationBootstrap();

		expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
			BANK_TRANSACTION_CATEGORIZATION_RECONCILE_SCHEDULER_ID,
			{every: 60 * 60 * 1000},
			expect.objectContaining({name: RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB}),
		);
		const statusClause = queryBuilder.andWhere.mock.calls.find(([, params]) => params?.claimableStatuses);
		expect(statusClause?.[1].claimableStatuses).toEqual(['PENDING', 'FAILED']);
	});

	it('removes the schedule when AI categorization is off', async () => {
		const {scheduler, queue} = createCategorizationServices({nodeEnv: 'production', enabled: false});

		await scheduler.onApplicationBootstrap();

		expect(queue.removeJobScheduler).toHaveBeenCalledWith(BANK_TRANSACTION_CATEGORIZATION_RECONCILE_SCHEDULER_ID);
		expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
	});

	it('skips FAILED rows in the hourly run', async () => {
		const queryBuilder = createUpdateQueryBuilder();
		const {scheduler} = createCategorizationServices({queryBuilder});

		await scheduler.reconcilePendingTransactions({includeFailed: false});

		const statusClause = queryBuilder.andWhere.mock.calls.find(([, params]) => params?.claimableStatuses);
		expect(statusClause?.[1].claimableStatuses).toEqual(['PENDING']);
	});
});
