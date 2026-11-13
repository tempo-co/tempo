import {
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	detectCurrencyExchangeMarker,
} from '../bank-transaction-financial-event';
import {BATCH_WRITE_CHUNK_SIZE, buildPostgresValuesList, chunkArray} from '../banking.utils';
import {compareIds} from '../own-transfer/own-transfer-detection';
import type {OwnTransferSqlExecutor} from '../own-transfer/own-transfer-recompute';
import {
	CurrencyExchangeCandidate,
	CurrencyExchangeLeg,
	confirmCurrencyExchanges,
	pairCurrencyExchanges,
} from './currency-exchange-pairing';

type LegRow = {
	id: string;
	connectionId: string;
	bankAccountId: string;
	date: string | null;
	indicator: string | null;
	amount: string;
	currency: string;
	accountCurrency: string | null;
	description: string | null;
	bankTransactionCode: string | null;
	bankTransactionSubCode: string | null;
	baseAmount: string | null;
	financialEventType: string | null;
	financialEventRuleVersion: string | null;
	currencyExchangeCounterpartId: string | null;
};

export type CurrencyExchangeRecomputeResult = {
	/** Rows whose exchange classification or counterpart changed. */
	transactionsChanged: number;
	/** Rows that became or stopped being exchanges; own-transfer detection reads that classification. */
	reclassifiedIds: string[];
	/** Rows that stopped being exchanges and went back to categorization; enqueue them after the commit. */
	requeuedIds: string[];
};

const CURRENCY_EXCHANGE = BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE;

const OWNER_ACCOUNTS_SQL = `SELECT account."id" FROM "bank_accounts" account
	JOIN "bank_connections" connection ON connection."id" = account."bankConnectionId"
	WHERE connection."accountId" = $1`;

const CATEGORIZATION_RESET_SQL = `"category" = NULL, "categorySource" = NULL, "categoryConfidence" = NULL,
	"categoryAppliedInputHash" = NULL, "categoryProvider" = NULL, "categoryModel" = NULL,
	"categoryPromptVersion" = NULL, "categorySearchTrace" = NULL, "categoryLastError" = NULL,
	"categoryUpdatedAt" = NULL`;

/**
 * Recomputes which of one owner's rows are currency exchanges, and their pairs. Must run inside a transaction: the
 * advisory lock serializes concurrent recomputes for the same owner and is released on commit or rollback. Only rows
 * whose classification or counterpart changed are written. A row that becomes an exchange leaves categorization
 * unless its category is manual; one that stops being an exchange goes back to the model.
 */
export async function recomputeCurrencyExchanges(
	executor: OwnTransferSqlExecutor,
	ownerId: string,
): Promise<CurrencyExchangeRecomputeResult> {
	await executor.query(`SELECT pg_advisory_xact_lock(hashtext('currency-exchange:' || $1))`, [ownerId]);

	// The text and code conditions only narrow the read; detectCurrencyExchangeMarker decides exactly.
	const rows = (await executor.query(
		`SELECT transaction."id", account."bankConnectionId" AS "connectionId", transaction."bankAccountId",
			to_char(COALESCE(transaction."bookingDate", transaction."transactionDate"), 'YYYY-MM-DD') AS "date",
			transaction."creditDebitIndicator" AS "indicator", transaction."amount"::text AS "amount",
			transaction."currency", account."currency" AS "accountCurrency", transaction."description",
			transaction."bankTransactionCode", transaction."bankTransactionSubCode",
			transaction."amountInBaseCurrency"::text AS "baseAmount", transaction."financialEventType",
			transaction."financialEventRuleVersion", transaction."currencyExchangeCounterpartId"
		FROM "bank_transactions" transaction
		JOIN "bank_accounts" account ON account."id" = transaction."bankAccountId"
		JOIN "bank_connections" connection ON connection."id" = account."bankConnectionId"
		WHERE connection."accountId" = $1
			AND (transaction."financialEventType" IS NOT NULL
				OR transaction."currencyExchangeCounterpartId" IS NOT NULL
				OR transaction."description" ~* 'exchanged\\s+to'
				OR concat_ws(' ', transaction."bankTransactionCode", transaction."bankTransactionSubCode") ~* 'spot')`,
		[ownerId],
	)) as LegRow[];
	// A stable row order keeps concurrent writers from locking the same rows in opposite orders.
	rows.sort((first, second) => compareIds(first.id, second.id));

	const candidates = rows.flatMap((row): Array<CurrencyExchangeCandidate & LegRow> => {
		const marker = detectCurrencyExchangeMarker({
			accountCurrency: row.accountCurrency,
			transactionCurrency: row.currency,
			creditDebitIndicator: row.indicator,
			description: row.description,
			bankTransactionCode: row.bankTransactionCode,
			bankTransactionSubCode: row.bankTransactionSubCode,
		});
		return marker ? [{...row, ...marker}] : [];
	});
	const confirmed = confirmCurrencyExchanges(candidates);
	const pairs = pairCurrencyExchanges(
		candidates.flatMap((candidate): CurrencyExchangeLeg[] =>
			confirmed.has(candidate.id) ? [{...candidate, targetCurrency: confirmed.get(candidate.id) ?? null}] : [],
		),
	);

	const becameExchange: string[] = [];
	const leftExchange: string[] = [];
	const classificationChanges = rows.flatMap(({id, financialEventType, financialEventRuleVersion}) => {
		const isExchange = confirmed.has(id);
		const wasExchange = financialEventType === CURRENCY_EXCHANGE;
		if (isExchange && !wasExchange) becameExchange.push(id);
		if (!isExchange && wasExchange) leftExchange.push(id);
		const unchanged = isExchange
			? wasExchange && financialEventRuleVersion === BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION
			: financialEventType === null;
		return unchanged ? [] : [{id, isExchange}];
	});
	const counterpartChanges = rows.flatMap(({id, currencyExchangeCounterpartId}) => {
		const counterpartId = pairs.get(id) ?? null;
		return counterpartId === currencyExchangeCounterpartId ? [] : [{id, counterpartId}];
	});

	for (const batch of chunkArray(classificationChanges, BATCH_WRITE_CHUNK_SIZE)) {
		const values = buildPostgresValuesList(
			batch.map(({id, isExchange}) =>
				isExchange
					? [
							id,
							CURRENCY_EXCHANGE,
							BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
							BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
						]
					: [id, null, null, null],
			),
			['uuid', 'varchar', 'varchar', 'varchar'],
		);
		await executor.query(
			`UPDATE "bank_transactions" AS transaction
			SET "financialEventType" = change."type", "financialEventSource" = change."source",
				"financialEventRuleVersion" = change."ruleVersion"
			FROM (VALUES ${values.sql}) AS change("id", "type", "source", "ruleVersion")
			WHERE transaction."id" = change."id"`,
			values.parameters,
		);
	}
	for (const batch of chunkArray(counterpartChanges, BATCH_WRITE_CHUNK_SIZE)) {
		const values = buildPostgresValuesList(
			batch.map(({id, counterpartId}) => [id, counterpartId]),
			['uuid', 'uuid'],
		);
		await executor.query(
			`UPDATE "bank_transactions" AS transaction
			SET "currencyExchangeCounterpartId" = change."counterpartId"
			FROM (VALUES ${values.sql}) AS change("id", "counterpartId")
			WHERE transaction."id" = change."id"`,
			values.parameters,
		);
	}

	// Single-table updates keep every guard on the target row, so Postgres re-checks them when a concurrent write
	// (for example a manual category) commits first.
	for (const ids of chunkArray(becameExchange, BATCH_WRITE_CHUNK_SIZE)) {
		await executor.query(
			`UPDATE "bank_transactions" SET ${CATEGORIZATION_RESET_SQL}, "categoryStatus" = 'NOT_APPLICABLE'
			WHERE "id" = ANY($2::uuid[]) AND "bankAccountId" IN (${OWNER_ACCOUNTS_SQL})
				AND "financialEventType" = $3 AND "categorySource" IS DISTINCT FROM 'MANUAL'`,
			[ownerId, ids, CURRENCY_EXCHANGE],
		);
	}
	const requeuedIds: string[] = [];
	for (const ids of chunkArray(leftExchange, BATCH_WRITE_CHUNK_SIZE)) {
		const result = (await executor.query(
			`UPDATE "bank_transactions" SET ${CATEGORIZATION_RESET_SQL}, "categoryStatus" = 'PENDING'
			WHERE "id" = ANY($2::uuid[]) AND "bankAccountId" IN (${OWNER_ACCOUNTS_SQL})
				AND "financialEventType" IS NULL AND "categoryStatus" = 'NOT_APPLICABLE'
				AND "categorySource" IS DISTINCT FROM 'MANUAL'
			RETURNING "id"`,
			[ownerId, ids],
		)) as [Array<{id: string}>, number] | Array<{id: string}>;
		const updated = Array.isArray(result[0]) ? (result[0] as Array<{id: string}>) : (result as Array<{id: string}>);
		requeuedIds.push(...updated.map(({id}) => id));
	}

	const changedIds = new Set([...classificationChanges, ...counterpartChanges].map(({id}) => id));
	return {
		transactionsChanged: changedIds.size,
		reclassifiedIds: [...becameExchange, ...leftExchange],
		requeuedIds,
	};
}
