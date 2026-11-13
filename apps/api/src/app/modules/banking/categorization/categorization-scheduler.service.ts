import {InjectQueue} from '@nestjs/bullmq';
import {Injectable, Logger, OnApplicationBootstrap} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import {createHash} from 'node:crypto';
import {In, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {bootstrapJobScheduler} from '@core/queue/job-scheduler';
import {
	APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB,
	BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE,
	BANK_TRANSACTION_CATEGORIZATION_QUEUE,
	BANK_TRANSACTION_CATEGORIZATION_RECONCILE_SCHEDULER_ID,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
	RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB,
} from '@core/queue/queue.constants';

import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import {BankTransaction} from '../bank-transaction.entity';
import {chunkArray, safeErrorName} from '../banking.utils';
import {BankTransactionCategorizationUnavailableError} from './bank-transaction-categorization.provider';
import {CLAIMABLE_CATEGORIZATION_STATUSES, notManualCategorySourceSql} from './bank-transaction-categorization.types';
import {claimableCondition} from './categorization-row-store.service';

export type BankTransactionCategorizationJobData = {
	transactionIds: string[];
};
export type ManualCategoryFollowUpJobData = {
	accountId: string;
	merchantKey: string;
	/** The rows the owner selected in the correction preview; only these may change. */
	transactionIds: string[];
};
export type BankTransactionCategorizationQueueData =
	BankTransactionCategorizationJobData | ManualCategoryFollowUpJobData | Record<string, never>;

const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
// About 21 minutes of exponential backoff in total, enough to ride out a database or Redis restart.
const FOLLOW_UP_JOB_OPTIONS = {
	attempts: 8,
	backoff: {type: 'exponential', delay: 5_000},
	removeOnComplete: true,
	removeOnFail: {age: 7 * 86_400, count: 100},
} as const;
// The queue connection retries forever while Redis is down, so a follow-up enqueue must not hold the request open.
const FOLLOW_UP_ENQUEUE_TIMEOUT_MS = 2_000;
/** Backoff type of categorize jobs, resolved by {@link categorizationRetryDelay} in the worker. */
export const CATEGORIZATION_RETRY_BACKOFF_TYPE = 'categorization-retry';
// A refusal from both Claude routes (busy bridge, rate limit, login renewal) usually clears within minutes.
const UNAVAILABLE_RETRY_DELAYS_MS = [60_000, 120_000, 300_000, 600_000, 1_200_000] as const;
const ORDINARY_RETRY_ATTEMPTS = 3;
const ORDINARY_RETRY_BASE_DELAY_MS = 1_000;
const CATEGORIZE_JOB_OPTIONS = {
	attempts: UNAVAILABLE_RETRY_DELAYS_MS.length + 1,
	backoff: {type: CATEGORIZATION_RETRY_BACKOFF_TYPE},
	removeOnFail: true,
} as const;

/**
 * Delay before retrying a categorize job after its attempt number `attemptsMade` failed, or -1 to stop. Unavailable
 * routes are retried over about 38 minutes, leaving the rows PENDING in between and for the hourly sweep afterwards;
 * other failures get two quick retries.
 */
export function categorizationRetryDelay(attemptsMade: number, error: unknown): number {
	if (error instanceof BankTransactionCategorizationUnavailableError)
		return UNAVAILABLE_RETRY_DELAYS_MS[attemptsMade - 1] ?? -1;
	if (attemptsMade >= ORDINARY_RETRY_ATTEMPTS) return -1;
	return ORDINARY_RETRY_BASE_DELAY_MS * 2 ** (attemptsMade - 1);
}

/** Puts categorization work on the queue: categorize jobs, manual follow-ups and the reconciliation sweeps. */
@Injectable()
export class CategorizationScheduler implements OnApplicationBootstrap {
	private readonly logger = new Logger(CategorizationScheduler.name);

	constructor(
		@InjectRepository(BankTransaction)
		private readonly repository: Repository<BankTransaction>,
		@InjectQueue(BANK_TRANSACTION_CATEGORIZATION_QUEUE)
		private readonly queue: Queue<BankTransactionCategorizationQueueData>,
		private readonly configurationService: ConfigurationService,
	) {}

	isEnabled(): boolean {
		return this.configurationService.get('AI_CATEGORIZATION_ENABLED');
	}

	async enqueueForTransactions(transactionIds: readonly string[]): Promise<void> {
		if (!this.isEnabled()) return;

		const uniqueIds = [...new Set(transactionIds.filter((id) => id.length > 0))].sort();
		if (uniqueIds.length === 0) return;

		const transactions = await this.repository.find({
			select: {id: true, categoryInputHash: true, financialEventType: true},
			where: {id: In(uniqueIds)},
		});
		const financialEventIds = new Set(
			transactions
				.filter(
					({financialEventType}) =>
						financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
				)
				.map(({id}) => id),
		);
		const categorizationIds = uniqueIds.filter((id) => !financialEventIds.has(id));
		if (categorizationIds.length === 0) return;
		const inputHashes = new Map(transactions.map(({id, categoryInputHash}) => [id, categoryInputHash]));
		await this.queue.addBulk(
			chunkArray(categorizationIds, BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE).map((batch) => ({
				name: CATEGORIZE_BANK_TRANSACTIONS_JOB,
				data: {transactionIds: batch},
				// An identical batch keeps its job ID, so a sweep while the job waits for a retry adds nothing.
				opts: {jobId: createJobId(batch, inputHashes), ...CATEGORIZE_JOB_OPTIONS},
			})),
		);
	}

	/**
	 * Every failed correction gets its own job: follow-ups are idempotent and read the current choices, so an extra run
	 * is harmless, while sharing a job id could drop a newer correction behind a running or exhausted job. The wait is
	 * bounded; if Redis is down, the add still completes once the connection returns.
	 */
	async enqueueManualCategoryFollowUp(data: ManualCategoryFollowUpJobData): Promise<void> {
		const added = this.queue.add(APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB, data, FOLLOW_UP_JOB_OPTIONS);
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				const error = new Error('The follow-up job was not added in time');
				error.name = 'EnqueueTimeout';
				reject(error);
			}, FOLLOW_UP_ENQUEUE_TIMEOUT_MS);
		});
		try {
			await Promise.race([added, timeout]);
		} catch (error) {
			added.catch(() => undefined);
			this.logger.warn(`Manual category follow-up enqueue failed: ${safeErrorName(error)}`);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Re-enqueues rows that are waiting for the model. The hourly run skips FAILED rows so a row that keeps failing is
	 * not sent to the provider every hour; those are retried on the next start.
	 */
	async reconcilePendingTransactions({includeFailed = true}: {includeFailed?: boolean} = {}): Promise<void> {
		if (!this.isEnabled()) return;

		try {
			const claimable = claimableCondition(
				'transaction',
				includeFailed ? CLAIMABLE_CATEGORIZATION_STATUSES : ['PENDING'],
			);
			const rows = await this.repository
				.createQueryBuilder('transaction')
				.select('transaction.id', 'id')
				.where(notManualCategorySourceSql('transaction."categorySource"'))
				.andWhere('transaction."financialEventType" IS DISTINCT FROM :financialEventType', {
					financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
				})
				.andWhere(claimable.sql, claimable.parameters)
				.getRawMany<{id: string}>();

			await this.enqueueForTransactions(rows.map(({id}) => id));
		} catch (error) {
			this.logger.warn(`Transaction categorization reconciliation failed: ${safeErrorName(error)}`);
		}
	}

	async onApplicationBootstrap(): Promise<void> {
		// Hourly reconciliation picks up rows left PENDING when an enqueue failed, for example while Redis was down.
		await bootstrapJobScheduler(
			this.queue,
			{
				schedulerId: BANK_TRANSACTION_CATEGORIZATION_RECONCILE_SCHEDULER_ID,
				jobName: RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB,
				everyMs: RECONCILE_INTERVAL_MS,
			},
			{enabled: this.isEnabled(), configurationService: this.configurationService, logger: this.logger},
		);
		// The startup sweep runs in the background: a large backlog or a stalled Redis connection must not hold up
		// boot. It logs its own failures. Tests skip it because their schema is recreated empty on every boot.
		if (this.configurationService.get('NODE_ENV') !== 'test') void this.reconcilePendingTransactions();
	}
}

function createJobId(transactionIds: readonly string[], inputHashes: ReadonlyMap<string, string | null>): string {
	const jobInput = transactionIds.map((id) => `${id}:${inputHashes.get(id) ?? ''}`).join('\n');
	return `categorize-${createHash('sha256').update(jobInput).digest('hex')}`;
}
