import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {BankTransactionCategory} from '@tempo/contracts';
import {EntityManager, Raw, Repository} from 'typeorm';

import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import {createBankTransactionCategorizationInputHash} from './bank-transaction-categorization-input';
import {
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
	BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
} from './bank-transaction-categorization.constants';
import {CategorizationContextLoader, transactionDateSql} from './categorization-context-loader.service';
import {CategorizationScheduler, ManualCategoryFollowUpJobData} from './categorization-scheduler.service';
import {historyCategoryValues, historyRecheckValues, manualCategoryValues} from './category-fields';
import {
	BulkCategoryFollowUps,
	MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS,
	ManualCategoryFollowUp,
	planManualCategoryFollowUp,
	whereBulkCategoryFollowUpCandidates,
	whereManualCategoryFollowUpCandidates,
} from './manual-category-follow-up';

/** Matches a row's `bankAccountId` against the owner's accounts. */
function ownedBankAccountId(accountId: string) {
	return Raw(
		(column) => `${column} IN (
			SELECT bank_account.id FROM bank_accounts bank_account
			INNER JOIN bank_connections connection ON connection.id = bank_account."bankConnectionId"
			WHERE connection."accountId" = :accountId
		)`,
		{accountId},
	);
}

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
				transactionIds: [transaction.id],
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
	 * Plans a bulk category on the owner's selected rows: per merchant of the selection, the follow-up its other rows
	 * would get with every selected row counted as the owner's choice of `category`, under one correction's rules. A
	 * merchant whose choices then disagree is rechecked, or left alone with AI categorization off.
	 */
	async planBulkCategory(
		accountId: string,
		selected: readonly Pick<BankTransaction, 'id' | 'merchantKey'>[],
		category: BankTransactionCategory,
	): Promise<BulkCategoryFollowUps> {
		const merchantKeys = [...new Set(selected.flatMap(({merchantKey}) => (merchantKey ? [merchantKey] : [])))];
		const followUps = {category, applyMerchantKeys: [] as string[], recheckMerchantKeys: [] as string[]};
		if (merchantKeys.length === 0) return followUps;
		const counts = await this.contextLoader.loadManualCategoryCounts(accountId, merchantKeys, {
			transactionIds: selected.map(({id}) => id),
			category,
		});
		for (const merchantKey of merchantKeys) {
			const followUp = planManualCategoryFollowUp(counts.get(merchantKey), this.scheduler.isEnabled());
			if (followUp?.action === 'APPLY') followUps.applyMerchantKeys.push(merchantKey);
			else if (followUp) followUps.recheckMerchantKeys.push(merchantKey);
		}
		return followUps;
	}

	/**
	 * Lists the owner's other rows from the selection's merchants that a bulk category's follow-ups would change, newest
	 * first and capped as one correction's preview is, without writing anything.
	 */
	async findBulkCategoryFollowUps(
		accountId: string,
		followUps: BulkCategoryFollowUps,
		selectedIds: readonly string[],
	): Promise<{transactions: BankTransaction[]; total: number}> {
		const [transactions, total] = await whereBulkCategoryFollowUpCandidates(
			this.repository.createQueryBuilder('transaction'),
			{accountId, followUps, selectedIds},
		)
			.select([
				'transaction.id',
				'transaction.bankAccountId',
				'transaction.merchantKey',
				'transaction.transactionDate',
				'transaction.bookingDate',
				'transaction.displayDescription',
				'transaction.amount',
				'transaction.currency',
				'transaction.category',
				'transaction.categoryStatus',
				'transaction.categorySource',
			])
			.orderBy(transactionDateSql(), 'DESC', 'NULLS FIRST')
			.addOrderBy('transaction.id', 'DESC')
			.take(MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS)
			.getManyAndCount();
		return {transactions, total};
	}

	/**
	 * Writes a bulk category inside the caller's transaction: every selected row takes the owner's manual `category`,
	 * then the listed follow-up rows take their follow-up (checked again against its rules, so a row that changed since
	 * the preview is left alone). Returns how many rows changed, and the rechecked ids to enqueue once it commits.
	 */
	async writeBulkCategory(
		manager: EntityManager,
		accountId: string,
		selected: readonly BankTransaction[],
		followUps: BulkCategoryFollowUps,
		followUpIds: readonly string[],
	): Promise<{updated: number; recheckIds: string[]}> {
		const repository = manager.getRepository(BankTransaction);
		// One statement for the whole selection, however large: each row takes its own input hash from the map.
		const inputHashes = Object.fromEntries(
			selected.map((transaction) => [transaction.id, createBankTransactionCategorizationInputHash(transaction)]),
		);
		const rowInputHashSql = () => 'CAST(:inputHashes AS jsonb) ->> CAST("id" AS text)';
		const result = await repository
			.createQueryBuilder()
			.update(BankTransaction)
			.set({
				...manualCategoryValues(followUps.category, ''),
				categoryInputHash: rowInputHashSql,
				categoryAppliedInputHash: rowInputHashSql,
			})
			.where('id = ANY(:selectedIds)', {selectedIds: selected.map(({id}) => id)})
			.andWhere(
				`"bankAccountId" IN (
					SELECT bank_account.id FROM bank_accounts bank_account
					INNER JOIN bank_connections connection ON connection.id = bank_account."bankConnectionId"
					WHERE connection."accountId" = :accountId
				)`,
				{accountId},
			)
			.setParameter('inputHashes', JSON.stringify(inputHashes))
			.execute();
		let updated = result.affected ?? 0;
		if (followUpIds.length === 0) return {updated, recheckIds: []};

		const candidates = {accountId, selectedIds: selected.map(({id}) => id), transactionIds: followUpIds};
		if (followUps.applyMerchantKeys.length > 0) {
			const applied = await whereBulkCategoryFollowUpCandidates(
				repository.createQueryBuilder().update(BankTransaction),
				{...candidates, followUps: {...followUps, recheckMerchantKeys: []}},
			)
				.set(
					historyCategoryValues(
						followUps.category,
						BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
						BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
					),
				)
				.execute();
			updated += applied.affected ?? 0;
		}
		if (followUps.recheckMerchantKeys.length === 0) return {updated, recheckIds: []};
		const rechecked = await whereBulkCategoryFollowUpCandidates(
			repository.createQueryBuilder().update(BankTransaction),
			{...candidates, followUps: {...followUps, applyMerchantKeys: []}},
		)
			// The category stays until the model replaces it, so a failed enqueue never leaves a row empty.
			.set(historyRecheckValues())
			.returning(['id'])
			.execute();
		const recheckIds = ((rechecked.raw ?? []) as {id: string}[]).map(({id}) => id);
		return {updated: updated + recheckIds.length, recheckIds};
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
		const values = manualCategoryValues(category, inputHash);
		const result = await this.repository.update(
			{
				id: transaction.id,
				bankAccountId: ownedBankAccountId(accountId),
			},
			values,
		);
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
				.set(
					historyCategoryValues(
						followUp.category,
						BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROVIDER,
						BANK_TRANSACTION_CATEGORIZATION_MANUAL_HISTORY_PROMPT_VERSION,
					),
				)
				.execute();
			return;
		}

		const result = await query
			// The category stays until the model replaces it, so a failed enqueue never leaves a row empty.
			.set(historyRecheckValues())
			.returning(['id'])
			.execute();
		const ids = ((result.raw ?? []) as {id: string}[]).map(({id}) => id);
		if (ids.length > 0) await this.scheduler.enqueueForTransactions(ids);
	}
}
