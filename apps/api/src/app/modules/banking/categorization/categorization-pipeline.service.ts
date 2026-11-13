import {Inject, Injectable, Logger} from '@nestjs/common';
import {BANK_TRANSACTION_CATEGORY_DEFINITIONS, type BankTransactionCategory} from '@tempo/contracts';

import {ConfigurationService} from '@core/config/config.service';
import {BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE} from '@core/queue/queue.constants';

import {safeErrorName} from '../banking.utils';
import {toBankTransactionCategorizationWebSearchInput} from './bank-transaction-categorization-input';
import {
	BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_PROVIDER_NAME,
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
	BankTransactionCategorizationResult,
	BankTransactionCategorizationWebSearchInput,
} from './bank-transaction-categorization.types';
import {
	BANK_TRANSACTION_CATEGORY_RULE_PROVIDER,
	BANK_TRANSACTION_CATEGORY_RULE_VERSION,
	getRuleCategory,
} from './bank-transaction-category-rules';
import {CategorizationContextLoader} from './categorization-context-loader.service';
import {CategorizationRowStore, ClaimedTransaction} from './categorization-row-store.service';
import {CategorizationScheduler} from './categorization-scheduler.service';

/**
 * Categorizes the rows of one job: claim, manual-history hint, fixed rules, the standard model pass, then one web
 * search per row the model could not place (`docs/categorization.md`, "Pipeline order").
 */
@Injectable()
export class CategorizationPipeline {
	private readonly logger = new Logger(CategorizationPipeline.name);

	constructor(
		private readonly rowStore: CategorizationRowStore,
		private readonly contextLoader: CategorizationContextLoader,
		private readonly scheduler: CategorizationScheduler,
		@Inject(BANK_TRANSACTION_CATEGORIZATION_PROVIDER)
		private readonly provider: BankTransactionCategorizationProvider,
		private readonly configurationService: ConfigurationService,
	) {}

	async processTransactionJob(transactionIds: readonly string[]): Promise<void> {
		if (!this.scheduler.isEnabled()) return;

		const uniqueIds = [...new Set(transactionIds.filter((id) => id.length > 0))];
		if (uniqueIds.length === 0) return;

		const batchIds = uniqueIds.slice(0, BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
		const remainingIds = uniqueIds.slice(BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE);
		if (remainingIds.length > 0) await this.scheduler.enqueueForTransactions(remainingIds);

		const transactions = await this.rowStore.loadBatch(batchIds);
		const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
		const {claimed, error} = await this.rowStore.claim(batchIds.flatMap((id) => transactionsById.get(id) ?? []));

		// batchIds is capped at the batch size, so every claimed transaction fits in one provider batch.
		if (claimed.length > 0) await this.categorizeClaimedBatch(claimed);
		// Rows already claimed are categorized first, so a failed claim retries only the rows it left unclaimed.
		if (error) throw error;
	}

	private async categorizeClaimedBatch(claimedBatch: readonly ClaimedTransaction[]): Promise<void> {
		// The owner's manual choices for the same merchant are only a hint for the model, never applied on their own:
		// one payee can receive different kinds of payments, such as rent and small shared costs. A rule applies only
		// when the owner has no choices for the merchant.
		const [manualHistory, sameAmounts] = await Promise.all([
			this.contextLoader.loadManualCategoryHistory(claimedBatch),
			this.contextLoader.loadSameAmountPayments(claimedBatch),
		]);
		const activeBatch: ClaimedTransaction[] = [];
		const ruleMatches: Promise<void>[] = [];
		for (const claimed of claimedBatch) {
			const previousManualCategories = manualHistory.get(claimed.transaction.id);
			const sameAmountPayments = sameAmounts.get(claimed.transaction.id);
			const ruleCategory = previousManualCategories ? null : getRuleCategory(claimed.transaction);
			if (ruleCategory) {
				ruleMatches.push(this.applyRuleCategory(claimed, ruleCategory));
			} else {
				activeBatch.push({
					...claimed,
					input: {
						...claimed.input,
						...(previousManualCategories ? {previousManualCategories} : {}),
						...(sameAmountPayments ? {sameAmountPayments} : {}),
					},
				});
			}
		}
		await Promise.all(ruleMatches);
		if (activeBatch.length === 0) return;

		const inputs = activeBatch.map(({input}) => input);
		let standardResults: readonly BankTransactionCategorizationResult[];

		try {
			standardResults = await this.provider.categorize(inputs, BANK_TRANSACTION_CATEGORY_DEFINITIONS);
		} catch (error) {
			await this.rowStore.markFailed(activeBatch, error);
			if (error instanceof BankTransactionCategorizationProviderError && error.retryable) throw error;
			return;
		}

		const resultById = new Map(standardResults.map((result) => [result.correlationId, result] as const));
		const webSearchEnabled = this.configurationService.get('AI_CATEGORIZATION_WEB_SEARCH_ENABLED');
		const promptVersions = new Map<string, string>();
		const searches: BankTransactionCategorizationWebSearchInput[] = [];
		for (const claimed of activeBatch) {
			const {input} = claimed;
			const category = resultById.get(input.correlationId)?.category;
			// With the owner's own choices as a hint, a NEEDS_REVIEW or OTHER answer means the row does not resemble
			// them; a web search on the payee name would only guess, so the row is left for the owner to review.
			const searchable =
				webSearchEnabled &&
				!input.previousManualCategories?.length &&
				(category === 'OTHER' || category === 'NEEDS_REVIEW');
			if (!searchable) continue;
			const searchInput = toBankTransactionCategorizationWebSearchInput(input);
			if (searchInput) searches.push(searchInput);
			else
				promptVersions.set(
					input.correlationId,
					BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_SKIPPED_PROMPT_VERSION,
				);
		}

		// Rows whose search could run on neither route wait for the job retry instead of going to review.
		const claimedIds = new Map(activeBatch.map(({input, transaction}) => [input.correlationId, transaction.id]));
		const unavailableIds = new Set<string>();
		let searchUnavailable: BankTransactionCategorizationUnavailableError | undefined;
		for (const input of searches) {
			const {correlationId} = input;
			if (searchUnavailable) {
				unavailableIds.add(correlationId);
				continue;
			}
			// Each search can take minutes, and the batch stays claimed until the last one ends. A row the batch no
			// longer holds is not searched.
			const held = await this.rowStore.renewClaims(activeBatch);
			if (!held.has(claimedIds.get(correlationId)!)) continue;
			let route: string | undefined;
			let result: BankTransactionCategorizationResult | null = null;
			try {
				const outcomes = await this.provider.categorizeWithWebSearch(
					[input],
					BANK_TRANSACTION_CATEGORY_DEFINITIONS,
				);
				const [outcome] = outcomes;
				if (outcomes.length === 1 && outcome.correlationId === correlationId) {
					route = outcome.provider;
					result = outcome.result;
				}
				if (!result) this.logger.warn('Transaction web-search fallback failed.');
			} catch (error) {
				this.logger.warn(`Transaction web-search fallback failed: ${safeErrorName(error)}`);
				if (error instanceof BankTransactionCategorizationUnavailableError) {
					searchUnavailable = error;
					unavailableIds.add(correlationId);
					continue;
				}
			}
			// A search that may have run is not retried, whichever layer noticed the failure: the row goes to review.
			if (result) {
				resultById.set(correlationId, reviewInconclusiveSearch(result));
				promptVersions.set(correlationId, BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_PROMPT_VERSION);
			} else {
				resultById.set(correlationId, this.failedSearchResult(correlationId, route));
				promptVersions.set(correlationId, BANK_TRANSACTION_CATEGORIZATION_WEB_SEARCH_FAILED_PROMPT_VERSION);
			}
		}
		if (searchUnavailable)
			await this.rowStore.markFailed(
				activeBatch.filter(({input}) => unavailableIds.has(input.correlationId)),
				searchUnavailable,
			);

		await Promise.all(
			activeBatch.map(async (claimed) => {
				const {correlationId} = claimed.input;
				const result = resultById.get(correlationId);
				if (!result || unavailableIds.has(correlationId)) return;
				await this.rowStore.complete(claimed, {
					category: result.category,
					categoryConfidence: String(result.confidence),
					categoryProvider: result.provider,
					categoryModel: result.model,
					categoryPromptVersion:
						promptVersions.get(correlationId) ?? BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
					categorySearchTrace: result.searchTrace ?? null,
				});
			}),
		);
		// Completed rows are no longer claimable, so the queue retry only picks up the pending ones.
		if (searchUnavailable) throw searchUnavailable;
	}

	/** Rule categories have no source, like own transfers: the owner did not choose them and no model guessed. */
	private applyRuleCategory(claimed: ClaimedTransaction, category: BankTransactionCategory): Promise<void> {
		return this.rowStore.complete(
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

	/**
	 * A search that failed after it may have run: the purpose stays unknown, so the row goes to review. It names the
	 * route that failed, or only the provider when the failure came before a route answered.
	 */
	private failedSearchResult(correlationId: string, route: string | undefined): BankTransactionCategorizationResult {
		return {
			correlationId,
			category: 'NEEDS_REVIEW',
			confidence: 0,
			provider: route ?? BANK_TRANSACTION_CATEGORIZATION_PROVIDER_NAME,
			model: this.configurationService.get('AI_CATEGORIZATION_MODEL'),
			searchTrace: {queries: [], sourceDomains: [], evidenceType: 'INSUFFICIENT'},
		};
	}
}

function reviewInconclusiveSearch(result: BankTransactionCategorizationResult): BankTransactionCategorizationResult {
	const evidenceType = result.searchTrace?.evidenceType;
	if (evidenceType === 'INSUFFICIENT' || evidenceType === 'CONFLICTING')
		return {...result, category: 'NEEDS_REVIEW', confidence: 0};
	return result;
}
