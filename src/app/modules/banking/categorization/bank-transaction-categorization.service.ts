import {InjectQueue} from '@nestjs/bullmq';
import {Inject, Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import {createHash} from 'node:crypto';
import {In, IsNull, Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {
	BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE,
	BANK_TRANSACTION_CATEGORIZATION_QUEUE,
	CATEGORIZE_BANK_TRANSACTIONS_JOB,
} from '@core/queue/queue.constants';

import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import {isOwnTransferCategorized, notOwnTransferCategorizedSql} from '../own-transfer/own-transfer-category';
import {
	createBankTransactionCategorizationInputHash,
	normalizeMerchantCategoryCode,
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
} from './bank-transaction-categorization.provider';
import {
	BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES,
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationSearchTrace,
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
	isManualCategorySource,
	notManualCategorySourceSql,
} from './bank-transaction-categorization.types';
import {
	BANK_TRANSACTION_CATEGORIES,
	BANK_TRANSACTION_CATEGORY_DEFINITIONS,
	BankTransactionCategory,
	isBankTransactionCategory,
} from './bank-transaction-category';

export type BankTransactionCategorizationJobData = {
	transactionIds: string[];
};

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
const MAX_ERROR_LENGTH = 500;
const CLAIMABLE_STATUSES = ['PENDING', 'FAILED'] as const;
// PROCESSING rows belong to a worker and NOT_APPLICABLE rows are never categorized.
const MERCHANT_REAPPLY_STATUSES = [...CLAIMABLE_STATUSES, 'COMPLETED'] as const;

type ManualCategoryCounts = Map<BankTransactionCategory, number>;
type CompletionValues = Pick<
	CategorizationUpdate,
	| 'category'
	| 'categoryConfidence'
	| 'categoryProvider'
	| 'categoryModel'
	| 'categoryPromptVersion'
	| 'categorySearchTrace'
>;
const REUSABLE_MANUAL_CATEGORIES = BANK_TRANSACTION_CATEGORIES.filter((category) => category !== 'NEEDS_REVIEW');

@Injectable()
export class BankTransactionCategorizationService {
	private readonly logger = new Logger(BankTransactionCategorizationService.name);

	constructor(
		@InjectRepository(BankTransaction)
		private readonly repository: Repository<BankTransaction>,
		@InjectQueue(BANK_TRANSACTION_CATEGORIZATION_QUEUE)
		private readonly queue: Queue<BankTransactionCategorizationJobData>,
		@Inject(BANK_TRANSACTION_CATEGORIZATION_PROVIDER)
		private readonly provider: BankTransactionCategorizationProvider,
		private readonly configurationService: ConfigurationService,
	) {}

	async enqueueForTransactions(transactionIds: readonly string[]): Promise<void> {
		if (!this.isEnabled()) return;

		const uniqueIds = [...new Set(transactionIds.filter((id) => id.length > 0))].sort();
		if (uniqueIds.length === 0) return;

		const transactions = await this.repository.find({
			select: ['id', 'categoryInputHash', 'financialEventType'],
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

	async reconcilePendingTransactions(): Promise<void> {
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
						claimableStatuses: CLAIMABLE_STATUSES,
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
		await this.reconcilePendingTransactions();
	}

	private async categorizeClaimedBatch(batch: readonly ClaimedTransaction[]): Promise<void> {
		const claimedBatch = await this.getActiveClaimedTransactions(batch);
		if (claimedBatch.length === 0) return;

		// The user's own manual choices for the same merchant come before the model: a single consistent choice is
		// applied directly, and mixed choices are passed to the model as context.
		const manualHistory = await this.loadManualCategoryHistory(claimedBatch);
		const activeBatch: ClaimedTransaction[] = [];
		const historyMatches: Promise<void>[] = [];
		for (const claimed of claimedBatch) {
			const counts = manualHistory.get(claimed.transaction.id);
			const category = getUnanimousCategory(counts);
			if (category) {
				historyMatches.push(this.applyManualHistoryCategory(claimed, category));
			} else {
				activeBatch.push(
					counts
						? {
								...claimed,
								input: {...claimed.input, previousManualCategories: toPreviousManualCategories(counts)},
							}
						: claimed,
				);
			}
		}
		await Promise.all(historyMatches);
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
		const inputById = new Map(inputs.map((input) => [input.correlationId, input]));
		const standardResultById = new Map(
			standardResults.map((result) => {
				const normalized = this.normalizeStandardResult(inputById.get(result.correlationId), result);
				return [normalized.correlationId, normalized] as const;
			}),
		);
		const webSearchEnabled = this.isWebSearchEnabled();
		const skippedWebSearchIds = new Set<string>();
		const webCandidates = inputs
			.filter((input) => {
				const category = standardResultById.get(input.correlationId)?.category;
				return (
					activeCorrelationIds.has(input.correlationId) &&
					webSearchEnabled &&
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
					categoryProvider: this.configurationService.get('AI_CATEGORIZATION_PROVIDER'),
					categoryModel: this.configurationService.get('AI_CATEGORIZATION_MODEL'),
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
	 * Returns, per batch transaction id, the account owner's manual category counts for the same merchant. Batches
	 * built by reconciliation can contain several accounts, so history is loaded and matched per account. A history
	 * failure only disables reuse; the batch still goes to the model.
	 */
	private async loadManualCategoryHistory(
		batch: readonly ClaimedTransaction[],
	): Promise<Map<string, ManualCategoryCounts>> {
		const batchByAccount = new Map<string, {id: string; merchantKey: string}[]>();
		for (const {transaction} of batch) {
			const accountId = transaction.bankAccount?.bankConnection?.accountId;
			const {id, merchantKey} = transaction;
			if (!accountId || !merchantKey) continue;
			batchByAccount.set(accountId, [...(batchByAccount.get(accountId) ?? []), {id, merchantKey}]);
		}

		const countsByTransaction = new Map<string, ManualCategoryCounts>();
		try {
			await Promise.all(
				[...batchByAccount].map(async ([accountId, entries]) => {
					const merchantKeys = [...new Set(entries.map(({merchantKey}) => merchantKey))];
					const history = await this.loadAccountManualCategoryCounts(accountId, merchantKeys);
					for (const {id, merchantKey} of entries) {
						const counts = history.get(merchantKey);
						if (counts) countsByTransaction.set(id, counts);
					}
				}),
			);
		} catch (error) {
			this.logger.warn(`Manual category history lookup failed: ${safeErrorName(error)}`);
			return new Map();
		}
		return countsByTransaction;
	}

	/** Counts the owner's reusable manual categories per merchant key. */
	private async loadAccountManualCategoryCounts(
		accountId: string,
		merchantKeys: readonly string[],
	): Promise<Map<string, ManualCategoryCounts>> {
		const rows = await this.repository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.select('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.category', 'category')
			.addSelect('COUNT(*)::int', 'count')
			.where('transaction."categorySource" = :manualSource', {manualSource: 'MANUAL'})
			.andWhere('transaction.category IN (:...reusableCategories)', {
				reusableCategories: REUSABLE_MANUAL_CATEGORIES,
			})
			.andWhere('transaction."ownTransferEvidence" IS NULL')
			.andWhere('transaction."financialEventType" IS NULL')
			.andWhere('transaction."merchantKey" IN (:...merchantKeys)', {merchantKeys})
			.andWhere('connection."accountId" = :accountId', {accountId})
			.groupBy('transaction."merchantKey"')
			.addGroupBy('transaction.category')
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
	 * Saves the owner's manual category on an owned transaction, then applies it to the owner's other rows from the same
	 * merchant. Returns false when the row no longer exists. The owner's choice is kept even when the follow-up fails;
	 * same-merchant rows then catch up on the next correction for that merchant.
	 */
	async setManualCategory(
		accountId: string,
		transaction: BankTransaction,
		category: BankTransactionCategory,
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
		try {
			await this.applyManualCategoryToMerchant(accountId, transaction.merchantKey);
		} catch (error) {
			this.logger.warn(`Applying a manual category to the same merchant failed: ${safeErrorName(error)}`);
		}
		return true;
	}

	/**
	 * Called after the owner sets a category manually. When all of the owner's manual choices for this merchant agree,
	 * the owner's other non-manual rows from the merchant take that category, without a model call. When the choices
	 * disagree, or no reusable choice is left (for example after a correction to NEEDS_REVIEW), rows that were filled
	 * from history go back to the model, which then sees any remaining choices. With AI categorization off they keep
	 * their current category.
	 */
	private async applyManualCategoryToMerchant(accountId: string, merchantKey: string | null): Promise<void> {
		if (!merchantKey) return;
		const counts = (await this.loadAccountManualCategoryCounts(accountId, [merchantKey])).get(merchantKey);

		const query = this.repository
			.createQueryBuilder()
			.update(BankTransaction)
			.where('"merchantKey" = :merchantKey', {merchantKey})
			.andWhere(
				`"bankAccountId" IN (
					SELECT bank_account.id FROM bank_accounts bank_account
					INNER JOIN bank_connections connection ON connection.id = bank_account."bankConnectionId"
					WHERE connection."accountId" = :accountId
				)`,
				{accountId},
			)
			.andWhere(notManualCategorySourceSql())
			.andWhere('"categoryStatus" IN (:...statuses)', {statuses: MERCHANT_REAPPLY_STATUSES})
			.andWhere('"categoryInputHash" IS NOT NULL')
			.andWhere('"ownTransferEvidence" IS NULL')
			.andWhere('"financialEventType" IS NULL');

		const category = getUnanimousCategory(counts);
		if (category) {
			await query
				.set({
					...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
					...this.historyCompletionValues(category),
					categoryStatus: 'COMPLETED',
					categorySource: 'HISTORY',
					categoryAppliedInputHash: () => '"categoryInputHash"',
					categoryUpdatedAt: new Date(),
				})
				.andWhere(`("category" IS DISTINCT FROM :category OR "categorySource" IS DISTINCT FROM 'HISTORY')`, {
					category,
				})
				.execute();
			return;
		}

		if (!this.isEnabled()) return;
		const result = await query
			// The category stays until the model replaces it, so a failed enqueue never leaves a row empty.
			.set({categoryStatus: 'PENDING', categoryUpdatedAt: new Date()})
			.andWhere(`"categorySource" = 'HISTORY'`)
			.returning(['id'])
			.execute();
		const ids = ((result.raw ?? []) as {id: string}[]).map(({id}) => id);
		if (ids.length > 0) await this.enqueueForTransactions(ids);
	}

	private applyManualHistoryCategory(claimed: ClaimedTransaction, category: BankTransactionCategory): Promise<void> {
		return this.completeClaimed(claimed, this.historyCompletionValues(category), 'HISTORY');
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
		source: BankTransactionCategorizationSource = 'AI',
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
			select: ['id', 'financialEventType'],
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
					claimableStatuses: CLAIMABLE_STATUSES,
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

	private async markBatchFailed(batch: readonly ClaimedTransaction[], error: unknown): Promise<void> {
		const safeMessage = this.safeFailureMessage(error);
		await Promise.all(
			batch.map(async ({transaction, inputHash}) => {
				const failed = await this.updateCategorizationWithGuard(
					transaction.id,
					inputHash,
					{
						...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
						categoryStatus: 'FAILED',
						categoryUpdatedAt: new Date(),
						categoryLastError: safeMessage,
					},
					'PROCESSING',
				);
				if (failed)
					this.applyLocalUpdate(transaction, {
						...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
						categoryStatus: 'FAILED',
						categoryLastError: safeMessage,
					});
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

	private normalizeStandardResult(
		input: BankTransactionCategorizationInput | undefined,
		result: BankTransactionCategorizationResult,
	): BankTransactionCategorizationResult {
		if (
			input &&
			result.category === 'TRANSPORTATION' &&
			input.transactionType === 'CARD_PAYMENT' &&
			!normalizeMerchantCategoryCode(input.merchantCategoryCode) &&
			input.counterpartyName === null
		) {
			return {...result, category: 'NEEDS_REVIEW', confidence: 0};
		}
		return result;
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
		if (CLAIMABLE_STATUSES.includes(status as (typeof CLAIMABLE_STATUSES)[number])) return true;
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
		if (
			error instanceof BankTransactionCategorizationProviderError &&
			/^OpenAI (?:categorization request failed|returned an invalid)/.test(error.message)
		) {
			return error.message.slice(0, MAX_ERROR_LENGTH);
		}
		return 'Transaction categorization failed.';
	}
}

function getUnanimousCategory(counts: ManualCategoryCounts | undefined): BankTransactionCategory | null {
	return counts?.size === 1 ? [...counts.keys()][0] : null;
}

function toPreviousManualCategories(
	counts: ManualCategoryCounts,
): {category: BankTransactionCategory; count: number}[] {
	return [...counts]
		.sort(
			([leftCategory, left], [rightCategory, right]) => right - left || leftCategory.localeCompare(rightCategory),
		)
		.map(([category, count]) => ({category, count}));
}
