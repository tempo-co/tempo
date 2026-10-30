import {BATCH_WRITE_CHUNK_SIZE, buildPostgresValuesList, chunkArray} from '../banking.utils';
import {verifyIbanAgainstIdentificationHash} from './iban';
import {OwnTransferAccount, OwnTransferTransaction, compareIds, detectOwnTransfers} from './own-transfer-detection';

/** Anything that can run parameterized SQL inside the caller's transaction (EntityManager or QueryRunner). */
export type OwnTransferSqlExecutor = {
	query(sql: string, parameters?: unknown[]): Promise<unknown>;
};

export type OwnTransferRecomputeResult = {
	accountIbansAdded: number;
	transactionsChanged: number;
};

type AccountRow = OwnTransferAccount & {identificationHash: string};
type TransactionRow = OwnTransferTransaction & {
	ownTransferEvidence: string | null;
	ownTransferCounterpartId: string | null;
};

/** Serializes own-transfer writes for one owner until the surrounding transaction ends. */
export async function lockOwnTransfers(executor: OwnTransferSqlExecutor, ownerId: string): Promise<void> {
	await executor.query(`SELECT pg_advisory_xact_lock(hashtext('own-transfer:' || $1))`, [ownerId]);
}

/**
 * Recomputes own-transfer state for one owner. Must run inside a transaction: the advisory lock
 * serializes concurrent recomputes for the same owner and is released on commit or rollback.
 * Only rows whose evidence or counterpart changed are written.
 */
export async function recomputeOwnTransfers(
	executor: OwnTransferSqlExecutor,
	ownerId: string,
): Promise<OwnTransferRecomputeResult> {
	await lockOwnTransfers(executor, ownerId);

	const accounts = (await executor.query(
		`SELECT account."id", account."currency", account."iban", account."name" AS "holderName",
			account."identificationHash", connection."aspspName"
		FROM "bank_accounts" account
		JOIN "bank_connections" connection ON connection."id" = account."bankConnectionId"
		WHERE connection."accountId" = $1`,
		[ownerId],
	)) as AccountRow[];
	if (accounts.length === 0) return {accountIbansAdded: 0, transactionsChanged: 0};

	const transactions = (await executor.query(
		`SELECT transaction."id", transaction."bankAccountId", transaction."amount"::text AS "amount",
			transaction."currency",
			to_char(COALESCE(transaction."bookingDate", transaction."transactionDate", transaction."valueDate"), 'YYYY-MM-DD') AS "date",
			transaction."transactionStatus", transaction."transactionType", transaction."financialEventType",
			transaction."counterpartyIban", transaction."description",
			transaction."ownTransferOverride" AS "override", transaction."ownTransferEvidence",
			transaction."ownTransferCounterpartId"
		FROM "bank_transactions" transaction
		WHERE transaction."bankAccountId" = ANY($1::uuid[])`,
		[accounts.map(({id}) => id)],
	)) as TransactionRow[];

	const accountIbansAdded = await addVerifiedAccountIbans(executor, accounts, transactions);
	const results = detectOwnTransfers({accounts, transactions});

	const changes = transactions.flatMap((transaction) => {
		const result = results.get(transaction.id);
		const evidence = result?.evidence ?? null;
		const counterpartId = result?.counterpartId ?? null;
		if (transaction.ownTransferEvidence === evidence && transaction.ownTransferCounterpartId === counterpartId) {
			return [];
		}
		return [{id: transaction.id, evidence, counterpartId}];
	});
	// A stable row order keeps concurrent writers from locking the same rows in opposite orders.
	changes.sort((first, second) => compareIds(first.id, second.id));

	for (const batch of chunkArray(changes, BATCH_WRITE_CHUNK_SIZE)) {
		const values = buildPostgresValuesList(
			batch.map(({id, evidence, counterpartId}) => [id, evidence, counterpartId]),
			['uuid', 'varchar', 'uuid'],
		);
		await executor.query(
			`UPDATE "bank_transactions" AS transaction
			SET "ownTransferEvidence" = change."evidence", "ownTransferCounterpartId" = change."counterpartId"
			FROM (VALUES ${values.sql}) AS change("id", "evidence", "counterpartId")
			WHERE transaction."id" = change."id"`,
			values.parameters,
		);
	}

	return {accountIbansAdded, transactionsChanged: changes.length};
}

/**
 * Fills a missing account IBAN when a counterparty IBAN seen in the owner's own ledger reproduces the
 * provider's account identification hash exactly. Never overwrites a stored IBAN.
 */
async function addVerifiedAccountIbans(
	executor: OwnTransferSqlExecutor,
	accounts: AccountRow[],
	transactions: TransactionRow[],
): Promise<number> {
	const accountsWithoutIban = accounts.filter((account) => !account.iban && account.identificationHash);
	if (accountsWithoutIban.length === 0) return 0;

	const candidateIbans = [
		...new Set(transactions.flatMap(({counterpartyIban}) => (counterpartyIban ? [counterpartyIban] : []))),
	].sort();
	let added = 0;
	for (const account of accountsWithoutIban) {
		const iban = candidateIbans.find((candidate) =>
			verifyIbanAgainstIdentificationHash(account.identificationHash, candidate, account.currency),
		);
		if (!iban) continue;

		await executor.query(`UPDATE "bank_accounts" SET "iban" = $1 WHERE "id" = $2 AND "iban" IS NULL`, [
			iban,
			account.id,
		]);
		account.iban = iban;
		added += 1;
	}
	return added;
}
