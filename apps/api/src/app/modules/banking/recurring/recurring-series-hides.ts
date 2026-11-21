import type {EntityManager} from 'typeorm';

import type {BankAccount} from '../bank-account.entity';

/**
 * Hides keep following their payments when rows of the account are removed: each removed row's id is replaced by the
 * row standing in for it, or dropped when none does. Runs in the caller's transaction, locking the hides it changes.
 */
export async function replaceHiddenSeriesPayments(
	manager: EntityManager,
	bankAccountId: BankAccount['id'],
	replacement: ReadonlyMap<string, string | null>,
): Promise<void> {
	if (replacement.size === 0) return;
	const hides: Array<{id: string; transactionIds: string[]}> = await manager.query(
		`SELECT hide."id", hide."transactionIds" FROM "recurring_series_hides" hide
		INNER JOIN "bank_connections" connection ON connection."accountId" = hide."accountId"
		INNER JOIN "bank_accounts" bank_account ON bank_account."bankConnectionId" = connection."id"
		WHERE bank_account."id" = $1 AND hide."transactionIds" && $2::uuid[]
		FOR UPDATE OF hide`,
		[bankAccountId, [...replacement.keys()]],
	);
	for (const hide of hides) {
		const transactionIds = [
			...new Set(hide.transactionIds.flatMap((id) => (replacement.has(id) ? (replacement.get(id) ?? []) : [id]))),
		];
		await manager.query(
			`UPDATE "recurring_series_hides" SET "transactionIds" = $2::uuid[], "updatedAt" = now() WHERE "id" = $1`,
			[hide.id, transactionIds],
		);
	}
}
