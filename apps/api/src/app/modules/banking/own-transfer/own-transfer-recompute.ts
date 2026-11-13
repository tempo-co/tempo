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
	/** The rows whose evidence or counterpart changed. */
	changedIds: string[];
};

/**
 * Rows whose detection inputs (amount, currency, dates, status, type, exchange classification, counterparty IBAN or
 * name, description or override) changed since the last recompute. Without a scope the whole history is recomputed.
 */
export type OwnTransferRecomputeScope = {transactionIds: readonly string[]};

type AccountRow = OwnTransferAccount & {identificationHash: string};
type TransactionRow = OwnTransferTransaction & {
	ownTransferEvidence: string | null;
	ownTransferCounterpartId: string | null;
};

const TRANSACTION_COLUMNS_SQL = `transaction."id", transaction."bankAccountId", transaction."amount"::text AS "amount",
	transaction."currency",
	to_char(COALESCE(transaction."bookingDate", transaction."transactionDate", transaction."valueDate"), 'YYYY-MM-DD') AS "date",
	transaction."transactionStatus", transaction."transactionType", transaction."financialEventType",
	transaction."counterpartyIban", transaction."counterpartyName", transaction."description",
	transaction."ownTransferOverride" AS "override", transaction."ownTransferEvidence",
	transaction."ownTransferCounterpartId"`;

/**
 * Every row with the currency and amount of a changed row or of its stored counterpart (pairs are stored on both
 * legs). Legs pair only on the same currency and opposite amount, so these rows decide the changed rows, their
 * former counterparts and every pair that competes with them exactly as the whole history would. The amount index
 * finds them without reading the rest of the history.
 */
const SCOPED_TRANSACTIONS_SQL = `WITH "changed" AS (
		SELECT "id", "currency", "amount", "ownTransferCounterpartId"
		FROM "bank_transactions"
		WHERE "bankAccountId" = ANY($1::uuid[]) AND "id" = ANY($2::uuid[])
	), "amounts" AS (
		SELECT upper("currency") AS "currency", abs("amount") AS "magnitude" FROM "changed"
		UNION
		SELECT upper(related."currency"), abs(related."amount")
		FROM "bank_transactions" related
		WHERE related."id" IN (SELECT "ownTransferCounterpartId" FROM "changed")
			AND related."bankAccountId" = ANY($1::uuid[])
	)
	SELECT ${TRANSACTION_COLUMNS_SQL}
	FROM "amounts"
	JOIN "bank_transactions" transaction ON transaction."bankAccountId" = ANY($1::uuid[])
		AND transaction."amount" IN ("amounts"."magnitude", -"amounts"."magnitude")
		AND upper(transaction."currency") = "amounts"."currency"`;

/** Serializes own-transfer writes for one owner until the surrounding transaction ends. */
export async function lockOwnTransfers(executor: OwnTransferSqlExecutor, ownerId: string): Promise<void> {
	await executor.query(`SELECT pg_advisory_xact_lock(hashtext('own-transfer:' || $1))`, [ownerId]);
}

/**
 * Recomputes own-transfer state for one owner. Must run inside a transaction: the advisory lock
 * serializes concurrent recomputes for the same owner and is released on commit or rollback.
 * Only rows whose evidence or counterpart changed are written.
 *
 * A scope limits the read to the rows that can pair with the changed ones. That gives the same result as the whole
 * history while the owner's accounts are unchanged; a change to them (a new account, holder name or currency) needs a
 * full recompute. An IBAN this fills in changes nothing outside the scope: a stored row naming it would have filled it
 * in when it was recomputed.
 */
export async function recomputeOwnTransfers(
	executor: OwnTransferSqlExecutor,
	ownerId: string,
	scope?: OwnTransferRecomputeScope,
): Promise<OwnTransferRecomputeResult> {
	if (scope?.transactionIds.length === 0) return {accountIbansAdded: 0, transactionsChanged: 0, changedIds: []};
	await lockOwnTransfers(executor, ownerId);

	const accounts = (await executor.query(
		`SELECT account."id", account."currency", account."iban", account."name" AS "holderName",
			account."identificationHash"
		FROM "bank_accounts" account
		JOIN "bank_connections" connection ON connection."id" = account."bankConnectionId"
		WHERE connection."accountId" = $1`,
		[ownerId],
	)) as AccountRow[];
	if (accounts.length === 0) return {accountIbansAdded: 0, transactionsChanged: 0, changedIds: []};

	const accountIds = accounts.map(({id}) => id);
	const transactions = (
		scope
			? await executor.query(SCOPED_TRANSACTIONS_SQL, [accountIds, scope.transactionIds])
			: await executor.query(
					`SELECT ${TRANSACTION_COLUMNS_SQL}
					FROM "bank_transactions" transaction
					WHERE transaction."bankAccountId" = ANY($1::uuid[])`,
					[accountIds],
				)
	) as TransactionRow[];

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

	return {accountIbansAdded, transactionsChanged: changes.length, changedIds: changes.map(({id}) => id)};
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
