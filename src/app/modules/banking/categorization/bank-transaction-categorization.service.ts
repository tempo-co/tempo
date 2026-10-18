import {InjectQueue} from '@nestjs/bullmq';
import {Inject, Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import {createHash} from 'node:crypto';
import {In, IsNull, Repository, SelectQueryBuilder} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
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
import {safeErrorName} from '../banking.utils';
import {isOwnTransferCategorized, notOwnTransferCategorizedSql} from '../own-transfer/own-transfer-category';
import {
	createBankTransactionCategorizationInputHash,
	toBankTransactionCategorizationInput,
	toBankTransactionCategorizationWebSearchInput,
} from './bank-transaction-categorization-input';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
	BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS,
	BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH,
	BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION,
} from './bank-transaction-categorization.constants';
import {
	BANK_TRANSACTION_CATEGORIZATION_PROVIDER,
	BankTransactionCategorizationProvider,
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from './bank-transaction-categorization.provider';
import {
	BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES,
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationSearchTrace,
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
	CLAIMABLE_CATEGORIZATION_STATUSES,
	PreviousManualCategory,
	isManualCategorySource,
	notManualCategorySourceSql,
} from './bank-transaction-categorization.types';
import {
	BANK_TRANSACTION_CATEGORY_DEFINITIONS,
	BankTransactionCategory,
	isBankTransactionCategory,
} from './bank-transaction-category';
import {
	BANK_TRANSACTION_CATEGORY_RULE_PROVIDER,
	BANK_TRANSACTION_CATEGORY_RULE_VERSION,
	getRuleCategory,
} from './bank-transaction-category-rules';
import {
	MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS,
	ManualCategoryCounts,
	ManualCategoryFollowUp,
	REUSABLE_MANUAL_CATEGORIES,
	planManualCategoryFollowUp,
	whereManualCategoryFollowUpCandidates,
	withoutOneOffChoices,
} from './manual-category-follow-up';

export type BankTransactionCategorizationJobData = {
	transactionIds: string[];
};
export type ManualCategoryFollowUpJobData = {
	accountId: string;
	merchantKey: string;
	/**
	 * The rows the owner selected in the correction preview; only these may change. Absent on retries queued before
	 * the preview existed, which therefore change nothing.
	 */
	transactionIds?: string[];
};
export type BankTransactionCategorizationQueueData =
	BankTransactionCategorizationJobData | ManualCategoryFollowUpJobData | Record<string, never>;

type ClaimedTransaction = {
	transaction: BankTransaction;
	input: BankTransactionCategorizationInput;
	inputHash: string;
};

type CategorizationUpdate = {
	category?: BankTransactionCategory | null;
	categoryStatus?: BankTransactionCategorizationStatus;
	categorySource?: BankTransactionCategorizationSource | null;
	categoryConfidence?: string | null;
	categoryAppliedInputHash?: string | null;
	categoryProvider?: string | null;
	categoryModel?: string | null;
	categoryPromptVersion?: string | null;
	categorySearchTrace?: BankTransactionCategorizationSearchTrace | null;
	categoryUpdatedAt?: Date;
	categoryLastError?: string | null;
};

const STALE_PROCESSING_AFTER_MS = 15 * 60 * 1000;
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
const MAX_ERROR_LENGTH = 500;

/** The rows a correction would change on the owner's other transactions from the same merchant. */
export type ManualCategoryPreview = {
	followUp: ManualCategoryFollowUp | null;
	transactions: BankTransaction[];
	total: number;
};

type CompletionValues = Pick<
	CategorizationUpdate,
	| 'category'
	| 'categoryConfidence'
	| 'categoryProvider'
	| 'categoryModel'
	| 'categoryPromptVersion'
	| 'categorySearchTrace'
>;
@Injectable()
export class BankTransactionCategorizationService {
	private readonly logger = new Logger(BankTransactionCategorizationService.name);

	constructor(
		@InjectRepository(BankTransaction)
		private readonly repository: Repository<BankTransaction>,
		@InjectQueue(BANK_TRANSACTION_CATEGORIZATION_QUEUE)
		private readonly queue: Queue<BankTransactionCategorizationQueueData>,
		@Inject(BANK_TRANSACTION_CATEGORIZATION_PROVIDER)
		private readonly provider: BankTransactionCategorizationProvider,
		private readonly configurationService: ConfigurationService,
	) {}

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
		const jobs = [];
		for (let index = 0; index < categorizationIds.length; index += BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE) {
			const batch = categorizationIds.slice(index, index + BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
			jobs.push({
				name: CATEGORIZE_BANK_TRANSACTIONS_JOB,
				data: {
					transactionIds: batch,
				},
				opts: {
					jobId: this.createJobId(batch, inputHashes),
					removeOnFail: true,
				},
			});
		}
		await this.queue.addBulk(jobs);
	}

	async processTransactionJob(transactionIds: readonly string[]): Promise<void> {
		if (!this.isEnabled()) return;

		const uniqueIds = [...new Set(transactionIds.filter((id) => id.length > 0))];
		if (uniqueIds.length === 0) return;

		const batchIds = uniqueIds.slice(0, BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
		const remainingIds = uniqueIds.slice(BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
		if (remainingIds.length > 0) {
			await this.enqueueForTransactions(remainingIds);
		}

		const transactions = await this.repository.find({
			where: {id: In(batchIds)},
			relations: {bankAccount: {bankConnection: true}},
		});
		const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
		const claimed: ClaimedTransaction[] = [];

		for (const id of batchIds) {
			const transaction = transactionsById.get(id);
			// Own transfers get their transfer category from the own-transfer rule, without a model call.
			if (!transaction || this.isFinancialEvent(transaction) || isOwnTransferCategorized(transaction)) continue;

			const input = toBankTransactionCategorizationInput({
				...transaction,
				aspspName: transaction.bankAccount?.bankConnection?.aspspName,
			});
			const inputHash = createBankTransactionCategorizationInputHash(input);
			if (!(await this.refreshInputHashAndResetStaleClassification(transaction, inputHash))) continue;
			if (isManualCategorySource(transaction.categorySource)) continue;

			if (!this.isClaimable(transaction)) continue;
			if (await this.claimTransaction(transaction.id, inputHash)) {
				this.applyLocalUpdate(transaction, {categoryStatus: 'PROCESSING', categoryUpdatedAt: new Date()});
				claimed.push({transaction, input, inputHash});
			}
		}

		// batchIds is capped at the batch size, so every claimed transaction fits in one provider batch.
		if (claimed.length > 0) await this.categorizeClaimedBatch(claimed);
	}

	/**
	 * Re-enqueues rows that are waiting for the model. The hourly run skips FAILED rows so a row that keeps failing is
	 * not sent to the provider every hour; those are retried on the next start.
	 */
	async reconcilePendingTransactions({includeFailed = true}: {includeFailed?: boolean} = {}): Promise<void> {
		if (!this.isEnabled()) return;

		try {
			const rows = await this.repository
				.createQueryBuilder('transaction')
				.select('transaction.id', 'id')
				.where(notManualCategorySourceSql('transaction."categorySource"'))
				.andWhere('transaction."financialEventType" IS DISTINCT FROM :financialEventType', {
					financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
				})
				.andWhere(
					`(
						transaction."categoryStatus" IN (:...claimableStatuses)
						OR (
							transaction."categoryStatus" = :processingStatus
							AND (
								transaction."categoryUpdatedAt" IS NULL
								OR transaction."categoryUpdatedAt" < :staleBefore
							)
						)
					)`,
					{
						claimableStatuses: includeFailed ? CLAIMABLE_CATEGORIZATION_STATUSES : ['PENDING'],
						processingStatus: 'PROCESSING',
						staleBefore: new Date(Date.now() - STALE_PROCESSING_AFTER_MS),
					},
				)
				.getRawMany<{id: string}>();

			await this.enqueueForTransactions(rows.map(({id}) => id));
		} catch (error) {
			this.logger.warn(`Transaction categorization reconciliation failed: ${safeErrorName(error)}`);
		}
	}

	async onApplicationBootstrap(): Promise<void> {
		await this.scheduleReconciliation();
		await this.reconcilePendingTransactions();
	}

	/** Hourly reconciliation picks up rows left PENDING when an enqueue failed, for example while Redis was down. */
	private async scheduleReconciliation(): Promise<void> {
		if (this.configurationService.get('NODE_ENV') === 'test') return;
		try {
			if (!this.isEnabled()) {
				await this.queue.removeJobScheduler(BANK_TRANSACTION_CATEGORIZATION_RECONCILE_SCHEDULER_ID);
				return;
			}
			await this.queue.upsertJobScheduler(
				BANK_TRANSACTION_CATEGORIZATION_RECONCILE_SCHEDULER_ID,
				{every: RECONCILE_INTERVAL_MS},
				{
					name: RECONCILE_BANK_TRANSACTION_CATEGORIZATION_JOB,
					data: {},
					opts: {attempts: 1, removeOnComplete: true, removeOnFail: {age: 86_400, count: 100}},
				},
			);
		} catch (error) {
			this.logger.warn(`Categorization reconciliation scheduling failed: ${safeErrorName(error)}`);
		}
	}

	private async categorizeClaimedBatch(batch: readonly ClaimedTransaction[]): Promise<void> {
		const claimedBatch = await this.getActiveClaimedTransactions(batch);
		if (claimedBatch.length === 0) return;

		// The owner's manual choices for the same merchant are only a hint for the model, never applied on their own:
		// one payee can receive different kinds of payments, such as rent and small shared costs. A rule applies only
		// when the owner has no choices for the merchant.
		const manualHistory = await this.loadManualCategoryHistory(claimedBatch);
		const activeBatch: ClaimedTransaction[] = [];
		const ruleMatches: Promise<void>[] = [];
		for (const claimed of claimedBatch) {
			const previousManualCategories = manualHistory.get(claimed.transaction.id);
			const ruleCategory = previousManualCategories ? null : getRuleCategory(claimed.transaction);
			if (ruleCategory) {
				ruleMatches.push(this.applyRuleCategory(claimed, ruleCategory));
			} else {
				activeBatch.push(
					previousManualCategories
						? {...claimed, input: {...claimed.input, previousManualCategories}}
						: claimed,
				);
			}
		}
		await Promise.all(ruleMatches);
		if (activeBatch.length === 0) return;

		const inputs = activeBatch.map(({input}) => input);
		let standardResults: readonly BankTransactionCategorizationResult[];

		try {
			standardResults = await this.provider.categorize(inputs, BANK_TRANSACTION_CATEGORY_DEFINITIONS);
			this.assertCompleteResults(inputs, standardResults);
		} catch (error) {
			await this.markBatchFailed(activeBatch, error);
			if (this.isRetryable(error)) throw error;
			return;
		}

		const activeBatchAfterStandardCategorization = await this.getActiveClaimedTransactions(activeBatch);
		if (activeBatchAfterStandardCategorization.length === 0) return;
		const activeCorrelationIds = new Set(
			activeBatchAfterStandardCategorization.map(({input}) => input.correlationId),
		);
		const standardResultById = new Map(standardResults.map((result) => [result.correlationId, result] as const));
		const webSearchEnabled = this.isWebSearchEnabled();
		const skippedWebSearchIds = new Set<string>();
		const webCandidates = inputs
			.filter((input) => {
				const category = standardResultById.get(input.correlationId)?.category;
				// With the owner's own choices as a hint, a NEEDS_REVIEW or OTHER answer means the row does not resemble
				// them; a web search on the payee name would only guess, so the row is left for the owner to review.
				return (
					activeCorrelationIds.has(input.correlationId) &&
					webSearchEnabled &&
					!input.previousManualCategories?.length &&
					(category === 'OTHER' || category === 'NEEDS_REVIEW')
				);
			})
			.map((input) => {
				const webSearchInput = toBankTransactionCategorizationWebSearchInput(input);
				if (webSearchInput === null) skippedWebSearchIds.add(input.correlationId);
				return webSearchInput;
			})
			.filter((input): input is NonNullable<typeof input> => input !== null);

		const webResults: BankTransactionCategorizationResult[] = [];
		const failedWebSearchIds = new Set<string>();
		const claimedByCorrelationId = new Map(
			activeBatchAfterStandardCategorization.map((claimed) => [claimed.input.correlationId, claimed]),
		);
		for (const webSearchInput of webCandidates) {
			const claimed = claimedByCorrelationId.get(webSearchInput.correlationId);
			if (!claimed) continue;
			const activeBeforeWebSearch = await this.getActiveClaimedTransactions([claimed]);
			if (activeBeforeWebSearch.length === 0) continue;
			try {
				const candidateResults = await this.provider.categorizeWithWebSearch(
					[webSearchInput],
					BANK_TRANSACTION_CATEGORY_DEFINITIONS,
				);
				this.assertCompleteResults([webSearchInput], candidateResults);
				webResults.push(...candidateResults.map((result) => this.normalizeWebSearchResult(result)));
			} catch (error) {
				this.logger.warn(`Transaction web-search fallback failed: ${safeErrorName(error)}`);
				failedWebSearchIds.add(webSearchInput.correlationId);
			}
		}

		for (const result of webResults) standardResultById.set(result.correlationId, result);
		const webResultIds = new Set(webResults.map(({correlationId}) => correlationId));
		await Promise.all(
			activeBatchAfterStandardCategorization.map(async (claimed) => {
				const result = standardResultById.get(claimed.input.correlationId);
				if (!result) return;
				const promptVersion = webResultIds.has(claimed.input.correlationId)
					? BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION
					: skippedWebSearchIds.has(claimed.input.correlationId)
						? BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION
						: failedWebSearchIds.has(claimed.input.correlationId)
							? BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION
							: BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION;
				await this.completeClaimed(claimed, {
					category: result.category,
					categoryConfidence: String(result.confidence),
					categoryProvider: result.provider ?? this.configurationService.get('AI_CATEGORIZATION_PROVIDER'),
					categoryModel: result.model ?? this.configurationService.get('AI_CATEGORIZATION_MODEL'),
					categoryPromptVersion: promptVersion,
					categorySearchTrace: result.searchTrace ?? null,
				});
			}),
		);
	}

	private async refreshInputHashAndResetStaleClassification(
		transaction: BankTransaction,
		inputHash: string,
	): Promise<boolean> {
		const previousHash = transaction.categoryInputHash;
		const hashChanged = previousHash !== inputHash;
		if (hashChanged) {
			const result = await this.repository.update(
				{
					id: transaction.id,
					categoryInputHash: previousHash == null ? IsNull() : previousHash,
					financialEventType: IsNull(),
					categoryStatus: transaction.categoryStatus ?? IsNull(),
				},
				{categoryInputHash: inputHash},
			);
			if ((result.affected ?? 0) === 0) return false;
			transaction.categoryInputHash = inputHash;
		}

		if (isManualCategorySource(transaction.categorySource)) return true;
		if (transaction.categoryStatus === 'COMPLETED') return true;
		const appliedHashIsStale =
			transaction.categoryAppliedInputHash !== null && transaction.categoryAppliedInputHash !== inputHash;
		if (!appliedHashIsStale) return true;

		const reset = await this.updateCategorizationWithGuard(
			transaction.id,
			inputHash,
			{
				...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
				categoryStatus: 'PENDING',
				categoryUpdatedAt: new Date(),
			},
			transaction.categoryStatus ?? undefined,
		);
		if (reset)
			this.applyLocalUpdate(transaction, {
				...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
				categoryStatus: 'PENDING',
			});
		return true;
	}

	/**
	 * Returns, per batch transaction id, the account owner's manual choices for the same merchant as a model hint.
	 * Batches built by reconciliation can contain several accounts, so history is loaded and matched per account. A
	 * history failure only drops the hint; the batch still goes to the model.
	 */
	private async loadManualCategoryHistory(
		batch: readonly ClaimedTransaction[],
	): Promise<Map<string, readonly PreviousManualCategory[]>> {
		const batchByAccount = new Map<string, {id: string; merchantKey: string}[]>();
		for (const {transaction} of batch) {
			const accountId = transaction.bankAccount?.bankConnection?.accountId;
			const {id, merchantKey} = transaction;
			if (!accountId || !merchantKey) continue;
			batchByAccount.set(accountId, [...(batchByAccount.get(accountId) ?? []), {id, merchantKey}]);
		}

		const hintsByTransaction = new Map<string, readonly PreviousManualCategory[]>();
		try {
			await Promise.all(
				[...batchByAccount].map(async ([accountId, entries]) => {
					const merchantKeys = [...new Set(entries.map(({merchantKey}) => merchantKey))];
					const [history, examples, categorized] = await Promise.all([
						this.loadAccountManualCategoryCounts(accountId, merchantKeys),
						this.loadAccountManualCategoryExamples(accountId, merchantKeys),
						this.loadAccountCompletedCategories(accountId, merchantKeys),
					]);
					for (const {id, merchantKey} of entries) {
						const counts = history.get(merchantKey);
						if (!counts) continue;
						const habits = withoutOneOffChoices(counts, categorized.get(merchantKey) ?? new Set());
						if (habits.size)
							hintsByTransaction.set(id, toPreviousManualCategories(habits, examples.get(merchantKey)));
					}
				}),
			);
		} catch (error) {
			this.logger.warn(`Manual category history lookup failed: ${safeErrorName(error)}`);
			return new Map();
		}
		return hintsByTransaction;
	}

	/**
	 * The owner's rows for these merchants that can count as history: a reusable category, and not an own transfer or
	 * financial event. `category` lets a correction preview count one row under its new category.
	 */
	private merchantHistoryQuery(
		accountId: string,
		merchantKeys: readonly string[],
		category = 'transaction.category',
	): SelectQueryBuilder<BankTransaction> {
		return this.repository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.where(`${category} IN (:...reusableCategories)`, {reusableCategories: REUSABLE_MANUAL_CATEGORIES})
			.andWhere('transaction."ownTransferEvidence" IS NULL')
			.andWhere('transaction."financialEventType" IS NULL')
			.andWhere('transaction."merchantKey" IN (:...merchantKeys)', {merchantKeys})
			.andWhere('connection."accountId" = :accountId', {accountId});
	}

	/**
	 * The amounts and dates of the owner's most recent manual choices per merchant and category, so the model can tell
	 * apart different kinds of payments to the same payee. Uses the same eligibility rules as the counts.
	 */
	private async loadAccountManualCategoryExamples(
		accountId: string,
		merchantKeys: readonly string[],
	): Promise<Map<string, Map<BankTransactionCategory, ManualCategoryExample[]>>> {
		const date = 'COALESCE(transaction."transactionDate", transaction."bookingDate", transaction."valueDate")';
		const rows = await this.merchantHistoryQuery(accountId, merchantKeys)
			.select('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.category', 'category')
			.addSelect('transaction.amount', 'amount')
			.addSelect(`${date}::text`, 'date')
			.andWhere('transaction."categorySource" = :manualSource', {manualSource: 'MANUAL'})
			.orderBy(date, 'DESC', 'NULLS LAST')
			.addOrderBy('transaction.id', 'DESC')
			.getRawMany<{
				merchantKey: string;
				category: BankTransactionCategory;
				amount: string;
				date: string | null;
			}>();

		const examples = new Map<string, Map<BankTransactionCategory, ManualCategoryExample[]>>();
		for (const {merchantKey, category, amount, date: exampleDate} of rows) {
			const byCategory = examples.get(merchantKey) ?? new Map<BankTransactionCategory, ManualCategoryExample[]>();
			const list = byCategory.get(category) ?? [];
			if (list.length < MAX_MANUAL_CATEGORY_EXAMPLES)
				list.push({amount: normalizeAmount(amount), date: exampleDate});
			byCategory.set(category, list);
			examples.set(merchantKey, byCategory);
		}
		return examples;
	}

	/** The categories the owner's completed rows per merchant key currently have, from any source. */
	private async loadAccountCompletedCategories(
		accountId: string,
		merchantKeys: readonly string[],
	): Promise<Map<string, Set<BankTransactionCategory>>> {
		const rows = await this.merchantHistoryQuery(accountId, merchantKeys)
			.select('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.category', 'category')
			.distinct(true)
			.andWhere('transaction."categoryStatus" = :completed', {completed: 'COMPLETED'})
			.getRawMany<{merchantKey: string; category: BankTransactionCategory}>();

		const categories = new Map<string, Set<BankTransactionCategory>>();
		for (const {merchantKey, category} of rows) {
			categories.set(merchantKey, (categories.get(merchantKey) ?? new Set()).add(category));
		}
		return categories;
	}

	/**
	 * Counts the owner's reusable manual categories per merchant key. With a `correction`, that row counts as if the
	 * owner had already set it manually to that category, under the same rules as every other manual row.
	 */
	private async loadAccountManualCategoryCounts(
		accountId: string,
		merchantKeys: readonly string[],
		correction?: {transactionId: string; category: BankTransactionCategory},
	): Promise<Map<string, ManualCategoryCounts>> {
		const category = correction
			? 'CASE WHEN transaction.id = :correctedId THEN :correctedCategory ELSE transaction.category END'
			: 'transaction.category';
		const isManual = correction
			? '(transaction."categorySource" = :manualSource OR transaction.id = :correctedId)'
			: 'transaction."categorySource" = :manualSource';
		const rows = await this.merchantHistoryQuery(accountId, merchantKeys, category)
			.select('transaction.merchantKey', 'merchantKey')
			.addSelect(category, 'category')
			.addSelect('COUNT(*)::int', 'count')
			.andWhere(isManual, {
				manualSource: 'MANUAL',
				...(correction && {correctedId: correction.transactionId, correctedCategory: correction.category}),
			})
			.groupBy('transaction."merchantKey"')
			.addGroupBy(category)
			.getRawMany<{merchantKey: string; category: BankTransactionCategory; count: number}>();

		const history = new Map<string, ManualCategoryCounts>();
		for (const row of rows) {
			const counts = history.get(row.merchantKey) ?? new Map<BankTransactionCategory, number>();
			counts.set(row.category, Number(row.count));
			history.set(row.merchantKey, counts);
		}
		return history;
	}

	/**
	 * Lists the owner's other rows that a manual correction would change, without writing anything or calling the
	 * model. The follow-up is planned from the owner's choices as they would be once the correction is saved.
	 */
	async previewManualCategory(
		accountId: string,
		transaction: BankTransaction,
		category: BankTransactionCategory,
	): Promise<ManualCategoryPreview> {
		const {merchantKey} = transaction;
		if (!merchantKey) return {followUp: null, transactions: [], total: 0};
		const counts = (
			await this.loadAccountManualCategoryCounts(accountId, [merchantKey], {
				transactionId: transaction.id,
				category,
			})
		).get(merchantKey);
		const followUp = planManualCategoryFollowUp(counts, this.isEnabled());
		if (!followUp) return {followUp: null, transactions: [], total: 0};

		const query = whereManualCategoryFollowUpCandidates(this.repository.createQueryBuilder('transaction'), {
			accountId,
			merchantKey,
			followUp,
		})
			.select([
				'transaction.id',
				'transaction.transactionDate',
				'transaction.bookingDate',
				'transaction.displayDescription',
				'transaction.amount',
				'transaction.currency',
				'transaction.category',
				'transaction.categoryStatus',
				'transaction.categorySource',
			])
			.andWhere('transaction.id <> :correctedTransactionId', {correctedTransactionId: transaction.id})
			// Newest first by the date the preview shows; pending rows without a booking date are the newest.
			.orderBy(
				'COALESCE(transaction."transactionDate", transaction."bookingDate", transaction."valueDate")',
				'DESC',
				'NULLS FIRST',
			)
			.addOrderBy('transaction.id', 'DESC')
			.take(MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS);
		const [transactions, total] = await query.getManyAndCount();
		return {followUp, transactions, total};
	}

	/**
	 * Saves the owner's manual category on an owned transaction, then applies the follow-up only to the selected rows
	 * from the same merchant. Rows that are not selected keep their category and are not remembered, so a later
	 * correction offers them again. Returns false when the row no longer exists. The owner's choice is kept even when
	 * the follow-up fails; the follow-up is then queued and retried with backoff.
	 */
	async setManualCategory(
		accountId: string,
		transaction: BankTransaction,
		category: BankTransactionCategory,
		followUpTransactionIds: readonly string[] = [],
	): Promise<boolean> {
		const inputHash = createBankTransactionCategorizationInputHash(transaction);
		const values: CategorizationUpdate & {categoryInputHash: string} = {
			...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
			category,
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
			categoryInputHash: inputHash,
			categoryAppliedInputHash: inputHash,
			categoryUpdatedAt: new Date(),
		};
		const result = await this.repository.update({id: transaction.id}, values);
		if (result.affected === 0) return false;
		Object.assign(transaction, values);
		const {merchantKey} = transaction;
		const transactionIds = [...new Set(followUpTransactionIds)].filter((id) => id !== transaction.id);
		if (!merchantKey || transactionIds.length === 0) return true;
		try {
			await this.processManualCategoryFollowUp({accountId, merchantKey, transactionIds});
		} catch (error) {
			this.logger.warn(`Applying a manual category to the same merchant failed: ${safeErrorName(error)}`);
			await this.enqueueManualCategoryFollowUp({accountId, merchantKey, transactionIds});
		}
		return true;
	}

	/**
	 * Every failed correction gets its own job: follow-ups are idempotent and read the current choices, so an extra run
	 * is harmless, while sharing a job id could drop a newer correction behind a running or exhausted job. The wait is
	 * bounded; if Redis is down, the add still completes once the connection returns.
	 */
	private async enqueueManualCategoryFollowUp(data: ManualCategoryFollowUpJobData): Promise<void> {
		const added = this.queue.add(APPLY_MANUAL_CATEGORY_TO_MERCHANT_JOB, data, FOLLOW_UP_JOB_OPTIONS);
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('EnqueueTimeout')), FOLLOW_UP_ENQUEUE_TIMEOUT_MS);
		});
		try {
			await Promise.race([added, timeout]);
		} catch (error) {
			added.catch(() => undefined);
			this.logger.warn(
				`Manual category follow-up enqueue failed: ${error instanceof Error ? error.message : safeErrorName(error)}`,
			);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Called after the owner sets a category manually, for the rows they selected. When all of the owner's manual
	 * choices for this merchant agree, those rows take that category, without a model call. When the choices disagree,
	 * or no reusable choice is left (for example after a correction to NEEDS_REVIEW), selected rows that were filled
	 * from history go back to the model, which then sees any remaining choices. With AI categorization off they keep
	 * their current category. Every selected id is checked against the same rules as the preview, so a stale or
	 * foreign id changes nothing. Queued retries run it too; it reads the owner's current choices, so a late retry
	 * applies the latest state.
	 */
	async processManualCategoryFollowUp({
		accountId,
		merchantKey,
		transactionIds = [],
	}: ManualCategoryFollowUpJobData): Promise<void> {
		if (transactionIds.length === 0) return;
		const counts = (await this.loadAccountManualCategoryCounts(accountId, [merchantKey])).get(merchantKey);
		const followUp = planManualCategoryFollowUp(counts, this.isEnabled());
		if (!followUp) return;

		const query = whereManualCategoryFollowUpCandidates(
			this.repository.createQueryBuilder().update(BankTransaction),
			{accountId, merchantKey, followUp, transactionIds},
		);
		if (followUp.action === 'APPLY') {
			await query
				.set({
					...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
					...this.historyCompletionValues(followUp.category),
					categoryStatus: 'COMPLETED',
					categorySource: 'HISTORY',
					categoryAppliedInputHash: () => '"categoryInputHash"',
					categoryUpdatedAt: new Date(),
				})
				.execute();
			return;
		}

		const result = await query
			// The category stays until the model replaces it, so a failed enqueue never leaves a row empty.
			.set({categoryStatus: 'PENDING', categoryUpdatedAt: new Date()})
			.returning(['id'])
			.execute();
		const ids = ((result.raw ?? []) as {id: string}[]).map(({id}) => id);
		if (ids.length > 0) await this.enqueueForTransactions(ids);
	}

	/** Rule categories have no source, like own transfers: the owner did not choose them and no model guessed. */
	private applyRuleCategory(claimed: ClaimedTransaction, category: BankTransactionCategory): Promise<void> {
		return this.completeClaimed(
			claimed,
			{
				category,
				categoryConfidence: '1',
				categoryProvider: BANK_TRANSACTION_CATEGORY_RULE_PROVIDER,
				categoryModel: null,
				categoryPromptVersion: BANK_TRANSACTION_CATEGORY_RULE_VERSION,
				categorySearchTrace: null,
			},
			null,
		);
	}

	private historyCompletionValues(category: BankTransactionCategory): CompletionValues {
		return {
			category,
			categoryConfidence: '1',
			categoryProvider: BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
			categoryModel: null,
			categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
			categorySearchTrace: null,
		};
	}

	private async completeClaimed(
		claimed: ClaimedTransaction,
		values: CompletionValues,
		source: BankTransactionCategorizationSource | null = 'AI',
	): Promise<void> {
		const completionValues: CategorizationUpdate = {
			...values,
			categoryStatus: 'COMPLETED',
			categorySource: source,
			categoryAppliedInputHash: claimed.inputHash,
			categoryLastError: null,
		};
		const applied = await this.updateCategorizationWithGuard(
			claimed.transaction.id,
			claimed.inputHash,
			{...completionValues, categoryUpdatedAt: new Date()},
			'PROCESSING',
		);
		if (applied) this.applyLocalUpdate(claimed.transaction, completionValues);
	}

	private async getActiveClaimedTransactions(batch: readonly ClaimedTransaction[]): Promise<ClaimedTransaction[]> {
		const currentTransactions = await this.repository.find({
			select: {id: true, financialEventType: true},
			where: {id: In(batch.map(({transaction}) => transaction.id))},
		});
		const currentTransactionsById = new Map(
			currentTransactions.map((transaction) => [transaction.id, transaction]),
		);
		return batch.filter(({transaction}) => {
			const currentTransaction = currentTransactionsById.get(transaction.id);
			return (
				currentTransaction !== undefined &&
				currentTransaction.financialEventType !== BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE
			);
		});
	}

	private async claimTransaction(id: string, inputHash: string): Promise<boolean> {
		const result = await this.repository
			.createQueryBuilder()
			.update(BankTransaction)
			.set({categoryStatus: 'PROCESSING', categoryUpdatedAt: new Date()})
			.where('id = :id', {id})
			.andWhere(notManualCategorySourceSql())
			.andWhere(notOwnTransferCategorizedSql())
			.andWhere('"categoryInputHash" = :inputHash', {inputHash})
			.andWhere('"financialEventType" IS DISTINCT FROM :financialEventType', {
				financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			})
			.andWhere(
				`(
					"categoryStatus" IN (:...claimableStatuses)
					OR (
						"categoryStatus" = :processingStatus
						AND ("categoryUpdatedAt" IS NULL OR "categoryUpdatedAt" < :staleBefore)
					)
				)`,
				{
					claimableStatuses: CLAIMABLE_CATEGORIZATION_STATUSES,
					processingStatus: 'PROCESSING',
					staleBefore: new Date(Date.now() - STALE_PROCESSING_AFTER_MS),
				},
			)
			.returning('id')
			.execute();
		return (result.affected ?? 0) > 0;
	}

	private async updateCategorizationWithGuard(
		id: string,
		inputHash: string,
		values: CategorizationUpdate,
		status?: string,
	): Promise<boolean> {
		const query = this.repository
			.createQueryBuilder()
			.update(BankTransaction)
			.set(values)
			.where('id = :id', {id})
			.andWhere(notManualCategorySourceSql())
			.andWhere(notOwnTransferCategorizedSql())
			.andWhere('"categoryInputHash" = :inputHash', {inputHash})
			.andWhere('"financialEventType" IS DISTINCT FROM :financialEventType', {
				financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			});
		if (status) query.andWhere('"categoryStatus" = :expectedStatus', {expectedStatus: status});
		const result = await query.execute();
		return (result.affected ?? 0) > 0;
	}

	/**
	 * A row sent back to the model keeps its category when the call fails, as long as that category was given for the
	 * same input. Unavailable routes stay PENDING for hourly reconciliation; ordinary failures stay FAILED for the
	 * job retry or next start. Other rows are cleared.
	 */
	private async markBatchFailed(batch: readonly ClaimedTransaction[], error: unknown): Promise<void> {
		const safeMessage = this.safeFailureMessage(error);
		const categoryStatus = error instanceof BankTransactionCategorizationUnavailableError ? 'PENDING' : 'FAILED';
		await Promise.all(
			batch.map(async ({transaction, inputHash}) => {
				const keepCategory = transaction.category != null && transaction.categoryAppliedInputHash === inputHash;
				const values: CategorizationUpdate = {
					...(keepCategory ? {} : BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES),
					categoryStatus,
					categoryLastError: safeMessage,
				};
				const failed = await this.updateCategorizationWithGuard(
					transaction.id,
					inputHash,
					{...values, categoryUpdatedAt: new Date()},
					'PROCESSING',
				);
				if (failed) this.applyLocalUpdate(transaction, values);
			}),
		);
	}

	private assertCompleteResults(
		inputs: readonly {correlationId: string}[],
		results: readonly BankTransactionCategorizationResult[],
	): void {
		const inputIds = inputs.map(({correlationId}) => correlationId);
		const resultIds = results.map(({correlationId}) => correlationId);
		const resultIdSet = new Set(resultIds);
		if (
			resultIds.length !== resultIdSet.size ||
			resultIds.length !== inputIds.length ||
			inputIds.some((id) => !resultIdSet.has(id)) ||
			results.some(
				(result) =>
					!isBankTransactionCategory(result.category) ||
					!Number.isFinite(result.confidence) ||
					result.confidence < 0 ||
					result.confidence > 1 ||
					!this.isValidSearchTrace(result.searchTrace),
			)
		) {
			throw new BankTransactionCategorizationProviderError('Invalid categorization provider result.', false);
		}
	}

	private normalizeWebSearchResult(result: BankTransactionCategorizationResult): BankTransactionCategorizationResult {
		const evidenceType = result.searchTrace?.evidenceType;
		if (evidenceType === 'INSUFFICIENT' || evidenceType === 'CONFLICTING') {
			return {...result, category: 'NEEDS_REVIEW', confidence: 0};
		}
		return result;
	}

	private isValidSearchTrace(trace: BankTransactionCategorizationSearchTrace | undefined): boolean {
		if (trace === undefined) return true;
		return (
			Array.isArray(trace.queries) &&
			trace.queries.length <= 1 &&
			trace.queries.every(
				(query) =>
					typeof query === 'string' &&
					query.length > 0 &&
					query.length <= BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH &&
					!/[\u0000-\u001f\u007f]/.test(query),
			) &&
			Array.isArray(trace.sourceDomains) &&
			trace.sourceDomains.length <= BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS &&
			trace.sourceDomains.every((domain) => this.isValidSearchTraceDomain(domain)) &&
			BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES.includes(trace.evidenceType)
		);
	}

	private isValidSearchTraceDomain(domain: unknown): boolean {
		return (
			typeof domain === 'string' &&
			/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)
		);
	}

	private isFinancialEvent(transaction: BankTransaction): boolean {
		return transaction.financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE;
	}

	private isClaimable(transaction: BankTransaction): boolean {
		const status = transaction.categoryStatus ?? 'PENDING';
		if (CLAIMABLE_CATEGORIZATION_STATUSES.includes(status as (typeof CLAIMABLE_CATEGORIZATION_STATUSES)[number]))
			return true;
		if (status !== 'PROCESSING') return false;
		if (!transaction.categoryUpdatedAt) return true;
		const updatedAt =
			transaction.categoryUpdatedAt instanceof Date
				? transaction.categoryUpdatedAt
				: new Date(transaction.categoryUpdatedAt);
		return Number.isNaN(updatedAt.getTime()) || updatedAt.getTime() < Date.now() - STALE_PROCESSING_AFTER_MS;
	}

	private applyLocalUpdate(transaction: BankTransaction, values: CategorizationUpdate): void {
		Object.assign(transaction, values);
	}

	private createJobId(transactionIds: readonly string[], inputHashes: ReadonlyMap<string, string | null>): string {
		const jobInput = transactionIds.map((id) => `${id}:${inputHashes.get(id) ?? ''}`).join('\n');
		return `categorize-${createHash('sha256').update(jobInput).digest('hex')}`;
	}

	private isEnabled(): boolean {
		return this.configurationService.get('AI_CATEGORIZATION_ENABLED');
	}

	private isWebSearchEnabled(): boolean {
		return this.configurationService.get('AI_CATEGORIZATION_WEB_SEARCH_ENABLED');
	}

	private isRetryable(error: unknown): boolean {
		return error instanceof BankTransactionCategorizationProviderError && error.retryable;
	}

	private safeFailureMessage(error: unknown): string {
		if (error instanceof BankTransactionCategorizationUnavailableError)
			return 'Claude categorization is temporarily unavailable.';
		if (
			error instanceof BankTransactionCategorizationProviderError &&
			/^Claude (?:categorization request failed|returned an invalid)/.test(error.message)
		) {
			return error.message.slice(0, MAX_ERROR_LENGTH);
		}
		return 'Transaction categorization failed.';
	}
}

/** Most recent manual choices per category the model sees as examples. */
const MAX_MANUAL_CATEGORY_EXAMPLES = 5;

type ManualCategoryExample = PreviousManualCategory['recentExamples'][number];

function toPreviousManualCategories(
	counts: ManualCategoryCounts,
	examples: Map<BankTransactionCategory, ManualCategoryExample[]> | undefined,
): PreviousManualCategory[] {
	return [...counts]
		.sort(
			([leftCategory, left], [rightCategory, right]) => right - left || leftCategory.localeCompare(rightCategory),
		)
		.map(([category, count]) => ({category, count, recentExamples: examples?.get(category) ?? []}));
}

/** "-12.30000000" -> "-12.30": numeric columns come back with the full scale. */
function normalizeAmount(amount: string): string {
	return amount.replace(/(\.\d{2}\d*?)0+$/, '$1');
}
