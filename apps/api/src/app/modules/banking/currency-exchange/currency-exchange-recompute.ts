import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES, parseCurrencyExchangeTarget} from '../bank-transaction-financial-event';
import {BATCH_WRITE_CHUNK_SIZE, buildPostgresValuesList, chunkArray} from '../banking.utils';
import {compareIds} from '../own-transfer/own-transfer-detection';
import type {OwnTransferSqlExecutor} from '../own-transfer/own-transfer-recompute';
import {CurrencyExchangeLeg, pairCurrencyExchanges} from './currency-exchange-pairing';

type LegRow = Omit<CurrencyExchangeLeg, 'targetCurrency'> & {
	description: string | null;
	financialEventType: string | null;
	currencyExchangeCounterpartId: string | null;
};

/**
 * Recomputes currency exchange pairs for one owner and returns how many rows changed. Must run inside a
 * transaction: the advisory lock serializes concurrent recomputes for the same owner and is released on
 * commit or rollback. Only rows whose counterpart changed are written.
 */
export async function recomputeCurrencyExchanges(executor: OwnTransferSqlExecutor, ownerId: string): Promise<number> {
	await executor.query(`SELECT pg_advisory_xact_lock(hashtext('currency-exchange:' || $1))`, [ownerId]);

	const legs = (await executor.query(
		`SELECT transaction."id", account."bankConnectionId" AS "connectionId",
			to_char(COALESCE(transaction."bookingDate", transaction."transactionDate"), 'YYYY-MM-DD') AS "date",
			UPPER(BTRIM(transaction."creditDebitIndicator")) AS "indicator", transaction."amount"::text AS "amount",
			UPPER(BTRIM(transaction."currency")) AS "currency",
			transaction."description", transaction."financialEventType",
			transaction."amountInBaseCurrency"::text AS "baseAmount", transaction."currencyExchangeCounterpartId"
		FROM "bank_transactions" transaction
		JOIN "bank_accounts" account ON account."id" = transaction."bankAccountId"
		JOIN "bank_connections" connection ON connection."id" = account."bankConnectionId"
		WHERE connection."accountId" = $1
			AND (transaction."financialEventType" = $2 OR transaction."currencyExchangeCounterpartId" IS NOT NULL)`,
		[ownerId, BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE],
	)) as LegRow[];

	const pairs = pairCurrencyExchanges(
		legs
			.filter(
				({financialEventType}) =>
					financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			)
			.map((leg) => ({...leg, targetCurrency: parseCurrencyExchangeTarget(leg.description)})),
	);
	const changes = legs.flatMap(({id, currencyExchangeCounterpartId}) => {
		const counterpartId = pairs.get(id) ?? null;
		return counterpartId === currencyExchangeCounterpartId ? [] : [{id, counterpartId}];
	});
	// A stable row order keeps concurrent writers from locking the same rows in opposite orders.
	changes.sort((first, second) => compareIds(first.id, second.id));

	for (const batch of chunkArray(changes, BATCH_WRITE_CHUNK_SIZE)) {
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
	return changes.length;
}
