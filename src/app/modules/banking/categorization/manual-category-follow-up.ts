import type {WhereExpressionBuilder} from 'typeorm';

import {CLAIMABLE_CATEGORIZATION_STATUSES, notManualCategorySourceSql} from './bank-transaction-categorization.types';
import {BANK_TRANSACTION_CATEGORIES, BankTransactionCategory} from './bank-transaction-category';

/**
 * What a manual correction does to the owner's other rows from the same merchant: `APPLY` sets the owner's single
 * consistent choice, `RECHECK` sends rows filled from history back to the model because the choices disagree or none
 * is left.
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
	query
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
		.andWhere('"categoryStatus" IN (:...followUpStatuses)', {followUpStatuses: FOLLOW_UP_STATUSES})
		.andWhere('"categoryInputHash" IS NOT NULL')
		.andWhere('"ownTransferEvidence" IS NULL')
		.andWhere('"financialEventType" IS NULL');
	if (followUp.action === 'APPLY') {
		query.andWhere(
			`("category" IS DISTINCT FROM :followUpCategory OR "categorySource" IS DISTINCT FROM 'HISTORY')`,
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
