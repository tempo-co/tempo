import {Inject, Injectable} from '@nestjs/common';
import {BANK_TRANSACTION_CATEGORY_DEFINITIONS} from '@tempo/contracts';

import {ConfigurationService} from '@core/config/config.service';
import {BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE} from '@core/queue/queue.constants';

import {toCategorizationSearch} from './bank-transaction-categorization-input';
import {BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION} from './bank-transaction-categorization.constants';
import {
	BANK_TRANSACTION_CATEGORIZATION_PROVIDER,
	BankTransactionCategorizationProvider,
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from './bank-transaction-categorization.provider';
import {BankTransactionCategorizationResult} from './bank-transaction-categorization.types';
import {CategorizationContextLoader} from './categorization-context-loader.service';
import {CategorizationRowStore, ClaimedTransaction} from './categorization-row-store.service';
import {CategorizationScheduler} from './categorization-scheduler.service';

/** Rows of one batch that go to the model in one call, sharing the one web search query they allow, if any. */
type RowGroup = {searchQuery?: string; rows: ClaimedTransaction[]};

/**
 * Categorizes the rows of one job: claim, the owner's history as hints, then one model call per row group with the
 * full input (`docs/categorization.md`, "Pipeline order").
 */
@Injectable()
export class CategorizationPipeline {
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

		// batchIds is capped at the batch size, so every claimed transaction fits in one provider call.
		if (claimed.length > 0) await this.categorizeClaimedBatch(claimed);
		// Rows already claimed are categorized first, so a failed claim retries only the rows it left unclaimed.
		if (error) throw error;
	}

	private async categorizeClaimedBatch(claimedBatch: readonly ClaimedTransaction[]): Promise<void> {
		// The owner's history for the same merchant is only a hint for the model, never applied on its own: one payee
		// can receive different kinds of payments, such as rent and small shared costs.
		const [manualHistory, sameAmounts] = await Promise.all([
			this.contextLoader.loadManualCategoryHistory(claimedBatch),
			this.contextLoader.loadSameAmountPayments(claimedBatch),
		]);
		const batch = claimedBatch.map((claimed): ClaimedTransaction => {
			const previousManualCategories = manualHistory.get(claimed.transaction.id);
			const sameAmountPayments = sameAmounts.get(claimed.transaction.id);
			return {
				...claimed,
				input: {
					...claimed.input,
					...(previousManualCategories ? {previousManualCategories} : {}),
					...(sameAmountPayments ? {sameAmountPayments} : {}),
				},
			};
		});

		const groups = this.groupRows(batch);
		const pending: ClaimedTransaction[] = [];
		let unavailable: BankTransactionCategorizationUnavailableError | undefined;
		let retryable: BankTransactionCategorizationProviderError | undefined;
		for (const [index, {searchQuery, rows}] of groups.entries()) {
			if (unavailable) {
				pending.push(...rows);
				continue;
			}
			// Each call can take minutes, and the batch stays claimed until the last one ends. A row the batch no
			// longer holds is not sent.
			let held = rows;
			if (index > 0) {
				const heldIds = await this.rowStore.renewClaims(groups.slice(index).flatMap((group) => group.rows));
				held = rows.filter(({transaction}) => heldIds.has(transaction.id));
				if (held.length === 0) continue;
			}
			let results: readonly BankTransactionCategorizationResult[];
			try {
				results = await this.provider.categorize(
					held.map(({input}) => input),
					BANK_TRANSACTION_CATEGORY_DEFINITIONS,
					searchQuery ? {searchQuery} : {},
				);
			} catch (error) {
				// Rows that could run on neither route wait for the job retry, and so do the groups after them.
				if (error instanceof BankTransactionCategorizationUnavailableError) {
					unavailable = error;
					pending.push(...held);
					continue;
				}
				await this.rowStore.markFailed(held, error);
				if (error instanceof BankTransactionCategorizationProviderError && error.retryable) retryable ??= error;
				continue;
			}
			// A failed write is not a provider failure: it fails the job, and the rows wait for their claim to lapse.
			const resultById = new Map(results.map((result) => [result.correlationId, result] as const));
			await Promise.all(
				held.map(async (claimed) => {
					const result = resultById.get(claimed.input.correlationId);
					if (!result) return;
					await this.rowStore.complete(claimed, {
						category: result.category,
						categoryConfidence: String(result.confidence),
						categoryProvider: result.provider,
						categoryModel: result.model,
						categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION,
						categorySearchTrace: result.searchTrace ?? null,
					});
				}),
			);
		}
		if (unavailable) await this.rowStore.markFailed(pending, unavailable);
		// Completed rows are no longer claimable, so the queue retry only picks up the pending and failed ones.
		if (unavailable ?? retryable) throw unavailable ?? retryable;
	}

	/**
	 * With web search on, rows that allow the same search query (the same sanitized merchant) form one group, so one
	 * call sees them together and can search once for all of them; rows without merchant text to search share one
	 * group without search. With web search off, the batch is one group.
	 */
	private groupRows(batch: readonly ClaimedTransaction[]): RowGroup[] {
		if (!this.configurationService.get('AI_CATEGORIZATION_WEB_SEARCH_ENABLED')) return [{rows: [...batch]}];
		const groups = new Map<string | undefined, RowGroup>();
		for (const claimed of batch) {
			const searchQuery = toCategorizationSearch(claimed.input)?.searchQuery;
			const group = groups.get(searchQuery) ?? {searchQuery, rows: []};
			group.rows.push(claimed);
			groups.set(searchQuery, group);
		}
		return [...groups.values()];
	}
}
