import {BANK_TRANSACTION_CATEGORIES, BankTransactionCategory} from '@wisp/contracts';
import type {WhereExpressionBuilder} from 'typeorm';

import {CLAIMABLE_CATEGORIZATION_STATUSES} from './bank-transaction-categorization.types';
import {modelCategorizableSql} from './category-fields';

/**
 * What a manual correction does to the other rows from the same merchant that the owner selected in the preview:
 * `APPLY` sets the owner's single consistent choice, `RECHECK` sends selected rows filled from history back to the
 * model because the choices disagree or none is left. Rows the owner did not select never change.
 */
export type ManualCategoryFollowUp = {action: 'APPLY'; category: BankTransactionCategory} | {action: 'RECHECK'};
export type ManualCategoryFollowUpAction = ManualCategoryFollowUp['action'];

/** The owner's manual choices for one merchant: how many rows they set to each category. */
export type ManualCategoryCounts = Map<BankTransactionCategory, number>;

/** Most rows a correction preview lists, and most rows one correction may update. */
export const MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS = 500;

export const REUSABLE_MANUAL_CATEGORIES: readonly BankTransactionCategory[] = BANK_TRANSACTION_CATEGORIES.filter(
	(category) => category !== 'NEEDS_REVIEW',
);

// PROCESSING rows belong to a worker and NOT_APPLICABLE rows are never categorized.
const FOLLOW_UP_STATUSES = [...CLAIMABLE_CATEGORIZATION_STATUSES, 'COMPLETED'] as const;

export function getUnanimousCategory(counts: ManualCategoryCounts | undefined): BankTransactionCategory | null {
	return counts?.size === 1 ? [...counts.keys()][0] : null;
}

/** With AI categorization off, rows have no model to go back to, so mixed choices change nothing. */
export function planManualCategoryFollowUp(
	counts: ManualCategoryCounts | undefined,
	recheckEnabled: boolean,
): ManualCategoryFollowUp | null {
	const category = getUnanimousCategory(counts);
	if (category) return {action: 'APPLY', category};
	return recheckEnabled ? {action: 'RECHECK'} : null;
}

/**
 * Limits a query on `bank_transactions` to the rows a follow-up may change: the owner's non-manual rows with the
 * merchant key (which includes the direction) that are not own transfers or currency exchanges, in a status
 * automation may write, and that the follow-up would actually change. `transactionIds` narrows this to the rows the
 * owner selected; ids outside these rules match nothing. Column names are unqualified, so the query must select from
 * `bank_transactions` alone.
 */
export function whereManualCategoryFollowUpCandidates<T extends WhereExpressionBuilder>(
	query: T,
	{
		accountId,
		merchantKey,
		followUp,
		transactionIds,
	}: {
		accountId: string;
		merchantKey: string;
		followUp: ManualCategoryFollowUp;
		transactionIds?: readonly string[];
	},
): T {
	query.where('"merchantKey" = :merchantKey', {merchantKey});
	whereFollowUpWritable(query, accountId);
	if (followUp.action === 'APPLY') {
		query.andWhere(
			// A row that already has the category keeps its source: offering it would change nothing visible.
			'"category" IS DISTINCT FROM :followUpCategory',
			{followUpCategory: followUp.category},
		);
	} else {
		query.andWhere(`"categorySource" = 'HISTORY'`);
	}
	if (transactionIds) {
		query.andWhere('id IN (:...followUpTransactionIds)', {followUpTransactionIds: transactionIds});
	}
	return query;
}

/**
 * The follow-ups of one bulk category for the selected rows' merchants. Every selected row counts as the owner's
 * choice of `category`, so a merchant whose choices agree applies `category` itself; the others are rechecked.
 */
export type BulkCategoryFollowUps = {
	category: BankTransactionCategory;
	applyMerchantKeys: readonly string[];
	recheckMerchantKeys: readonly string[];
};

/**
 * The rows a bulk category's follow-ups may change, under one correction's rules
 * (`whereManualCategoryFollowUpCandidates`), leaving out the selected rows themselves. `transactionIds` narrows it to
 * those rows. Column names are unqualified, so the query must select from `bank_transactions` alone.
 */
export function whereBulkCategoryFollowUpCandidates<T extends WhereExpressionBuilder>(
	query: T,
	{
		accountId,
		followUps: {category, applyMerchantKeys, recheckMerchantKeys},
		selectedIds,
		transactionIds,
	}: {
		accountId: string;
		followUps: BulkCategoryFollowUps;
		selectedIds: readonly string[];
		transactionIds?: readonly string[];
	},
): T {
	const apply =
		applyMerchantKeys.length > 0
			? `("merchantKey" IN (:...applyMerchantKeys) AND "category" IS DISTINCT FROM :followUpCategory)`
			: null;
	const recheck =
		recheckMerchantKeys.length > 0
			? `("merchantKey" IN (:...recheckMerchantKeys) AND "categorySource" = 'HISTORY')`
			: null;
	query.where(`(${[apply, recheck].filter(Boolean).join(' OR ') || 'FALSE'})`, {
		applyMerchantKeys,
		recheckMerchantKeys,
		followUpCategory: category,
	});
	whereFollowUpWritable(query, accountId);
	// An array parameter, so a filter's thousands of selected rows stay one bind value.
	query.andWhere('NOT (id = ANY(:selectedIds))', {selectedIds});
	if (transactionIds) {
		query.andWhere(transactionIds.length > 0 ? 'id IN (:...followUpTransactionIds)' : 'FALSE', {
			followUpTransactionIds: transactionIds,
		});
	}
	return query;
}

/** The owner's rows a follow-up may write: not manual, not an own transfer or exchange, in a status automation writes. */
function whereFollowUpWritable(query: WhereExpressionBuilder, accountId: string): void {
	query
		.andWhere(
			`"bankAccountId" IN (
				SELECT bank_account.id FROM bank_accounts bank_account
				INNER JOIN bank_connections connection ON connection.id = bank_account."bankConnectionId"
				WHERE connection."accountId" = :accountId
			)`,
			{accountId},
		)
		.andWhere(modelCategorizableSql())
		.andWhere('"categoryStatus" IN (:...followUpStatuses)', {followUpStatuses: FOLLOW_UP_STATUSES})
		.andWhere('"categoryInputHash" IS NOT NULL');
}
