import {categoryResetSql, modelCategorizableSql, ruleCategorySql} from '../categorization/category-fields';
import {
	OwnTransferRecomputeResult,
	OwnTransferRecomputeScope,
	OwnTransferSqlExecutor,
	recomputeOwnTransfers,
} from './own-transfer-recompute';

export const OWN_TRANSFER_CATEGORY_PROVIDER = 'own-transfer';
export const OWN_TRANSFER_CATEGORY_RULE_VERSION = 'own-transfer-category-v1';

const TRANSFER_CATEGORY_SQL = `CASE upper("creditDebitIndicator") WHEN 'CRDT' THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END`;

const OWNER_ACCOUNTS_SQL = `SELECT account."id" FROM "bank_accounts" account
	JOIN "bank_connections" connection ON connection."id" = account."bankConnectionId"
	WHERE connection."accountId" = $1`;

/**
 * Gives every detected own transfer of the owner the matching transfer category (TRANSFER_IN for money in,
 * TRANSFER_OUT for money out) without a model call, and returns rows this rule categorized earlier that are no longer
 * own transfers to the model. Manual categories and currency exchanges are never touched. Returns the ids sent back,
 * which the caller enqueues after its transaction commits. With ids, only those rows are checked: the ones whose
 * own-transfer evidence a scoped recompute may have changed.
 */
export async function applyOwnTransferCategories(
	executor: OwnTransferSqlExecutor,
	ownerId: string,
	transactionIds?: readonly string[],
): Promise<string[]> {
	if (transactionIds?.length === 0) return [];
	const ids = transactionIds ?? null;
	// A single-table UPDATE keeps every condition on the target row, so Postgres re-checks all of them when a
	// concurrent write (for example a manual category) commits first.
	await executor.query(
		`UPDATE "bank_transactions"
		SET ${ruleCategorySql({category: TRANSFER_CATEGORY_SQL, provider: '$2', ruleVersion: '$3'})}
		WHERE "bankAccountId" IN (${OWNER_ACCOUNTS_SQL})
			AND ($4::uuid[] IS NULL OR "id" = ANY($4::uuid[]))
			AND "ownTransferEvidence" IS NOT NULL
			AND upper("creditDebitIndicator") IN ('CRDT', 'DBIT')
			AND "categorySource" IS DISTINCT FROM 'MANUAL'
			AND "financialEventType" IS NULL
			AND (
				"category" IS DISTINCT FROM ${TRANSFER_CATEGORY_SQL}
				OR "categoryStatus" IS DISTINCT FROM 'COMPLETED'
				OR "categorySource" IS NOT NULL
				OR "categoryProvider" IS DISTINCT FROM $2
			)`,
		[ownerId, OWN_TRANSFER_CATEGORY_PROVIDER, OWN_TRANSFER_CATEGORY_RULE_VERSION, ids],
	);

	const requeued = (await executor.query(
		`UPDATE "bank_transactions"
		SET ${categoryResetSql('PENDING')}
		WHERE "bankAccountId" IN (${OWNER_ACCOUNTS_SQL})
			AND ($3::uuid[] IS NULL OR "id" = ANY($3::uuid[]))
			AND "categoryProvider" = $2
			AND ${modelCategorizableSql()}
		RETURNING "id"`,
		[ownerId, OWN_TRANSFER_CATEGORY_PROVIDER, ids],
	)) as [Array<{id: string}>, number] | Array<{id: string}>;
	const rows = Array.isArray(requeued[0]) ? (requeued[0] as Array<{id: string}>) : (requeued as Array<{id: string}>);
	return rows.map(({id}) => id);
}

/**
 * Recomputes the owner's own transfers and their categories inside the caller's transaction. In scope only the scoped
 * rows and the rows whose evidence changed can need a new category. Returns the rows sent back to the model, which the
 * caller enqueues after its transaction commits.
 */
export async function recomputeOwnTransfersAndCategories(
	executor: OwnTransferSqlExecutor,
	ownerId: string,
	scope?: OwnTransferRecomputeScope,
): Promise<{result: OwnTransferRecomputeResult; requeuedIds: string[]}> {
	const result = await recomputeOwnTransfers(executor, ownerId, scope);
	const categoryIds = scope && [...new Set([...scope.transactionIds, ...result.changedIds])];
	return {result, requeuedIds: await applyOwnTransferCategories(executor, ownerId, categoryIds)};
}
