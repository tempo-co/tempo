import type {OwnTransferSqlExecutor} from './own-transfer-recompute';

export const OWN_TRANSFER_CATEGORY_PROVIDER = 'own-transfer';
export const OWN_TRANSFER_CATEGORY_RULE_VERSION = 'own-transfer-category-v1';

/** Whether the own-transfer rule categorizes this row; it mirrors the conditions in the rule's SQL. */
export function isOwnTransferCategorized(transaction: {
	ownTransferEvidence?: string | null;
	creditDebitIndicator?: string | null;
	financialEventType?: string | null;
}): boolean {
	const indicator = transaction.creditDebitIndicator?.toUpperCase();
	return (
		Boolean(transaction.ownTransferEvidence) &&
		!transaction.financialEventType &&
		(indicator === 'CRDT' || indicator === 'DBIT')
	);
}

/** SQL condition for rows the own-transfer rule does not categorize, so the model may claim or complete them. */
export function notOwnTransferCategorizedSql(): string {
	return `NOT ("ownTransferEvidence" IS NOT NULL AND "financialEventType" IS NULL
		AND upper(COALESCE("creditDebitIndicator", '')) IN ('CRDT', 'DBIT'))`;
}

const TRANSFER_CATEGORY_SQL = `CASE upper("creditDebitIndicator") WHEN 'CRDT' THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END`;

const OWNER_ACCOUNTS_SQL = `SELECT account."id" FROM "bank_accounts" account
	JOIN "bank_connections" connection ON connection."id" = account."bankConnectionId"
	WHERE connection."accountId" = $1`;

/**
 * Gives every detected own transfer of the owner the matching transfer category (TRANSFER_IN for money in,
 * TRANSFER_OUT for money out) without a model call, and returns rows this rule categorized earlier that are no longer
 * own transfers to the model. Manual categories and currency exchanges are never touched. Returns the ids sent back,
 * which the caller enqueues after its transaction commits.
 */
export async function applyOwnTransferCategories(executor: OwnTransferSqlExecutor, ownerId: string): Promise<string[]> {
	// A single-table UPDATE keeps every condition on the target row, so Postgres re-checks all of them when a
	// concurrent write (for example a manual category) commits first.
	await executor.query(
		`UPDATE "bank_transactions"
		SET "category" = ${TRANSFER_CATEGORY_SQL}, "categoryStatus" = 'COMPLETED', "categorySource" = NULL,
			"categoryConfidence" = '1', "categoryProvider" = $2, "categoryModel" = NULL, "categoryPromptVersion" = $3,
			"categorySearchTrace" = NULL, "categoryLastError" = NULL,
			"categoryAppliedInputHash" = "categoryInputHash", "categoryUpdatedAt" = now()
		WHERE "bankAccountId" IN (${OWNER_ACCOUNTS_SQL})
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
		[ownerId, OWN_TRANSFER_CATEGORY_PROVIDER, OWN_TRANSFER_CATEGORY_RULE_VERSION],
	);

	const requeued = (await executor.query(
		`UPDATE "bank_transactions"
		SET "category" = NULL, "categoryStatus" = 'PENDING', "categorySource" = NULL, "categoryConfidence" = NULL,
			"categoryAppliedInputHash" = NULL, "categoryProvider" = NULL, "categoryModel" = NULL,
			"categoryPromptVersion" = NULL, "categorySearchTrace" = NULL, "categoryLastError" = NULL,
			"categoryUpdatedAt" = now()
		WHERE "bankAccountId" IN (${OWNER_ACCOUNTS_SQL})
			AND "ownTransferEvidence" IS NULL
			AND "financialEventType" IS NULL
			AND "categoryProvider" = $2
			AND "categorySource" IS DISTINCT FROM 'MANUAL'
		RETURNING "id"`,
		[ownerId, OWN_TRANSFER_CATEGORY_PROVIDER],
	)) as [Array<{id: string}>, number] | Array<{id: string}>;
	const rows = Array.isArray(requeued[0]) ? (requeued[0] as Array<{id: string}>) : (requeued as Array<{id: string}>);
	return rows.map(({id}) => id);
}
