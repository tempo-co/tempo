import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {BankTransactionCategory} from '@tempo/contracts';
import {Repository} from 'typeorm';

import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import {createBankTransactionCategorizationInputHash} from './bank-transaction-categorization-input';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
	BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
} from './bank-transaction-categorization.constants';
import {CategorizationContextLoader, transactionDateSql} from './categorization-context-loader.service';
import type {CategorizationUpdate} from './categorization-row-store.service';
import {CategorizationScheduler, ManualCategoryFollowUpJobData} from './categorization-scheduler.service';
import {
	MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS,
	ManualCategoryFollowUp,
	planManualCategoryFollowUp,
	whereManualCategoryFollowUpCandidates,
} from './manual-category-follow-up';

/** The rows a correction would change on the owner's other transactions from the same merchant. */
export type ManualCategoryPreview = {
	followUp: ManualCategoryFollowUp | null;
	transactions: BankTransaction[];
	total: number;
};

/** The owner's own category choices: the correction preview, saving a choice, and its follow-up on sibling rows. */
@Injectable()
export class ManualCategoryService {
	private readonly logger = new Logger(ManualCategoryService.name);

	constructor(
		@InjectRepository(BankTransaction)
		private readonly repository: Repository<BankTransaction>,
		private readonly contextLoader: CategorizationContextLoader,
		private readonly scheduler: CategorizationScheduler,
	) {}

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
			await this.contextLoader.loadManualCategoryCounts(accountId, [merchantKey], {
				transactionId: transaction.id,
				category,
			})
		).get(merchantKey);
		const followUp = planManualCategoryFollowUp(counts, this.scheduler.isEnabled());
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
			.orderBy(transactionDateSql(), 'DESC', 'NULLS FIRST')
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
			await this.scheduler.enqueueManualCategoryFollowUp({accountId, merchantKey, transactionIds});
		}
		return true;
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
		transactionIds,
	}: ManualCategoryFollowUpJobData): Promise<void> {
		if (transactionIds.length === 0) return;
		const counts = (await this.contextLoader.loadManualCategoryCounts(accountId, [merchantKey])).get(merchantKey);
		const followUp = planManualCategoryFollowUp(counts, this.scheduler.isEnabled());
		if (!followUp) return;

		const query = whereManualCategoryFollowUpCandidates(
			this.repository.createQueryBuilder().update(BankTransaction),
			{accountId, merchantKey, followUp, transactionIds},
		);
		if (followUp.action === 'APPLY') {
			await query
				.set({
					...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
					category: followUp.category,
					categoryConfidence: '1',
					categoryProvider: BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
					categoryModel: null,
					categoryPromptVersion: BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
					categorySearchTrace: null,
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
		if (ids.length > 0) await this.scheduler.enqueueForTransactions(ids);
	}
}
