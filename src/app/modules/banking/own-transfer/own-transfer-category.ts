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
	await executor.query(
		`UPDATE "bank_transactions" AS transaction
		SET "category" = change."category", "categoryStatus" = 'COMPLETED', "categorySource" = NULL,
			"categoryConfidence" = '1', "categoryProvider" = $2, "categoryModel" = NULL, "categoryPromptVersion" = $3,
			"categorySearchTrace" = NULL, "categoryLastError" = NULL,
			"categoryAppliedInputHash" = transaction."categoryInputHash", "categoryUpdatedAt" = now()
		FROM (
			SELECT "id", CASE upper("creditDebitIndicator") WHEN 'CRDT' THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END
				AS "category"
			FROM "bank_transactions"
			WHERE "bankAccountId" IN (${OWNER_ACCOUNTS_SQL})
				AND "ownTransferEvidence" IS NOT NULL
				AND upper("creditDebitIndicator") IN ('CRDT', 'DBIT')
				AND "categorySource" IS DISTINCT FROM 'MANUAL'
				AND "financialEventType" IS NULL
		) AS change
		WHERE transaction."id" = change."id"
			AND (
				transaction."category" IS DISTINCT FROM change."category"
				OR transaction."categoryStatus" IS DISTINCT FROM 'COMPLETED'
				OR transaction."categorySource" IS NOT NULL
				OR transaction."categoryProvider" IS DISTINCT FROM $2
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
			AND "categoryProvider" = $2
			AND "categorySource" IS DISTINCT FROM 'MANUAL'
		RETURNING "id"`,
		[ownerId, OWN_TRANSFER_CATEGORY_PROVIDER],
	)) as [Array<{id: string}>, number] | Array<{id: string}>;
	const rows = Array.isArray(requeued[0]) ? (requeued[0] as Array<{id: string}>) : (requeued as Array<{id: string}>);
	return rows.map(({id}) => id);
}
