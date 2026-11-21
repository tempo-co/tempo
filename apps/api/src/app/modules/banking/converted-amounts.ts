import type {EntityManager} from 'typeorm';

import type {Account} from '@modules/account/account.entity';

import type {BankAccount} from './bank-account.entity';
import type {BankTransaction} from './bank-transaction.entity';
import {BATCH_WRITE_CHUNK_SIZE, buildPostgresValuesList, chunkArray} from './banking.utils';
import {
	FX_RATE_MAX_AGE_DAYS,
	convertEcbAmountSql,
	ecbRateSql,
} from './services/bank-transaction-amount-conversion.utils';

/*
 * The amount in the reporting currency (`amountInBaseCurrency`, with its `baseAmountMethod` and `baseAmountRateDate`):
 * every write and clear of it. Each function runs in a transaction that already holds the reporting-currency lock
 * (`lockReportingCurrencyForAmountWrites`, or `lockReportingCurrencyForChange` for a change), so the currency it reads
 * or is given cannot change before the transaction commits.
 */

/**
 * Transaction columns a converted amount is derived from, with their Postgres types. When any of them changes, the
 * stored amount is stale: a history write clears it and the conversion re-checks them before writing.
 */
const CONVERSION_INPUT_COLUMNS = [
	['amount', 'numeric'],
	['currency', 'varchar'],
	['transactionDate', 'date'],
	['bookingDate', 'date'],
	['instructedAmount', 'numeric'],
	['instructedCurrency', 'varchar'],
] as const;

/** A stored row as a history write found it, before changing it. */
export type ConversionInputs = Pick<BankTransaction, 'id' | (typeof CONVERSION_INPUT_COLUMNS)[number][0]>;

/** `ROW(...)` of the conversion inputs of the given table alias, for comparing them as one value. */
function conversionInputsSql(alias: string): string {
	return `ROW(${CONVERSION_INPUT_COLUMNS.map(([column]) => `${alias}."${column}"`).join(', ')})`;
}

/** Rows without a conversion method are (re)converted, including amounts stored before methods were recorded. */
const PENDING_SQL = `t."baseAmountMethod" IS NULL`;

/** The "same currency" rule: a row already in the reporting currency is its own converted amount, in exact cents. */
const inReportingCurrencySql = (alias: string, reportingCurrency: string) =>
	`${alias}."currency" = ${reportingCurrency}`;
const sameCurrencyAmountSql = (alias: string) => `ROUND(${alias}."amount", 2)`;

/**
 * Stores the amounts of the account's unconverted rows already in the owner's reporting currency right away, so they
 * never wait for the conversion job and count in totals as soon as they are written. Other currencies wait for rates,
 * and every row of an owner without a reporting currency.
 */
export async function copySameCurrencyAmounts(
	manager: EntityManager,
	ownerId: Account['id'],
	bankAccountId: BankAccount['id'],
	/** Limits the update to these rows; every row of the account when omitted. */
	transactionIds?: readonly string[],
): Promise<void> {
	if (transactionIds?.length === 0) return;
	await manager.query(
		`UPDATE "bank_transactions" AS t
		SET "amountInBaseCurrency" = ${sameCurrencyAmountSql('t')}, "baseAmountMethod" = 'SAME',
			"baseAmountRateDate" = NULL, "updatedAt" = CURRENT_TIMESTAMP
		FROM "bank_accounts" bank_account
		INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
		INNER JOIN "accounts" account ON account."id" = connection."accountId"
		WHERE bank_account."id" = $1 AND account."id" = $2
			AND t."bankAccountId" = bank_account."id"
			AND t."baseAmountMethod" IS NULL
			AND ${inReportingCurrencySql('t', 'account."baseCurrency"')}${transactionIds ? ' AND t."id" = ANY($3::uuid[])' : ''}`,
		transactionIds ? [bankAccountId, ownerId, transactionIds] : [bankAccountId, ownerId],
	);
}

/**
 * Clears the converted amounts of the account's rows whose conversion inputs a write changed, so the conversion job
 * converts them again. Compares the rows as the write found them with the stored ones, so rows it left keep theirs.
 */
export async function clearStaleConvertedAmounts(
	manager: EntityManager,
	ownerId: Account['id'],
	bankAccountId: BankAccount['id'],
	previousRows: readonly ConversionInputs[],
): Promise<void> {
	const rows = previousRows.map((row) => [row.id, ...CONVERSION_INPUT_COLUMNS.map(([column]) => row[column])]);
	const casts = ['uuid', ...CONVERSION_INPUT_COLUMNS.map(([, cast]) => cast)];
	const columns = ['id', ...CONVERSION_INPUT_COLUMNS.map(([column]) => column)].map((column) => `"${column}"`);
	for (const chunk of chunkArray(rows, BATCH_WRITE_CHUNK_SIZE)) {
		const values = buildPostgresValuesList(chunk, casts);
		await manager.query(
			`UPDATE "bank_transactions" AS t
			SET "amountInBaseCurrency" = NULL, "baseAmountMethod" = NULL, "baseAmountRateDate" = NULL
			FROM (VALUES ${values.sql}) AS previous(${columns.join(', ')}), "bank_accounts" bank_account
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			WHERE t."bankAccountId" = $${values.parameters.length + 1}
				AND bank_account."id" = t."bankAccountId" AND connection."accountId" = $${values.parameters.length + 2}
				AND t."id" = previous."id"
				AND t."amountInBaseCurrency" IS NOT NULL
				AND ${conversionInputsSql('t')} IS DISTINCT FROM ${conversionInputsSql('previous')}`,
			[...values.parameters, bankAccountId, ownerId],
		);
	}
}

/**
 * For a change of the owner's reporting currency to `currency`: clears every converted amount of the owner and copies
 * the ones already in it, so no amount is ever read as the new currency while it is in the old one. Returns whether
 * rows are left for the conversion job.
 */
export async function convertAgainForChange(
	manager: EntityManager,
	ownerId: Account['id'],
	currency: string,
): Promise<boolean> {
	await manager.query(
		`UPDATE "bank_transactions" t
		SET "amountInBaseCurrency" = CASE WHEN ${inReportingCurrencySql('t', '$2')} THEN ${sameCurrencyAmountSql('t')} END,
			"baseAmountMethod" = CASE WHEN ${inReportingCurrencySql('t', '$2')} THEN 'SAME' END,
			"baseAmountRateDate" = NULL,
			"updatedAt" = CURRENT_TIMESTAMP
		FROM "bank_accounts" bank_account
		INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
		WHERE t."bankAccountId" = bank_account."id" AND connection."accountId" = $1
			AND (t."baseAmountMethod" IS NOT NULL OR ${inReportingCurrencySql('t', '$2')})`,
		[ownerId, currency],
	);
	const [{toConvert}] = await manager.query<Array<{toConvert: boolean}>>(
		`SELECT EXISTS (
			SELECT 1 FROM "bank_transactions" t
			INNER JOIN "bank_accounts" bank_account ON bank_account."id" = t."bankAccountId"
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			WHERE connection."accountId" = $1 AND ${PENDING_SQL}
		) AS "toConvert"`,
		[ownerId],
	);
	return toConvert;
}

/** Rate date of a transaction, as used by the conversion. */
export const CONVERSION_RATE_DATE_SQL = `COALESCE(t."transactionDate", t."bookingDate")`;

/**
 * The reference rate for the transaction's rate date: the newest final one (the publication of that date's business
 * day itself, or, once a later publication is stored, the previous one, for an ECB holiday). While none is final,
 * the newest stored one stands in, so the row counts in totals at once; {@link correctableSql} converts it again once
 * the day's own publication is stored. Both at most `$3` days before the rate date.
 * Holidays are inferred, not looked up: a weekday ECB skipped for any other reason is treated the same way.
 */
const rateLateral = (alias: string, currency: string) => `
	LEFT JOIN LATERAL (
		SELECT rate."rateToEur", rate."rateDate"
		FROM "bank_transaction_fx_rates" rate
		WHERE rate."currency" = ${currency}
			AND rate."rateDate" BETWEEN candidate."rateDate" - $3::integer AND candidate."rateDate"
		ORDER BY
			(
				rate."rateDate" = candidate."businessDate"
				OR EXISTS (
					SELECT 1 FROM "bank_transaction_fx_rates" later
					WHERE later."currency" = rate."currency" AND later."rateDate" > candidate."rateDate"
				)
			) DESC,
			rate."rateDate" DESC
		LIMIT 1
	) ${alias} ON TRUE`;

/**
 * An ECB amount converted with a stand-in rate whose own publication is now stored: a rate of the row's currency or
 * the reporting currency (`base`) newer than the older of the two rates used (the stored rate date), on or before the
 * rate date. A holiday row already uses the final rate, since no publication falls between it and the rate date; a
 * row that is converted again to the same amount is not written.
 */
const correctableSql = (base: string) => `(
	t."baseAmountMethod" = 'ECB' AND EXISTS (
		SELECT 1 FROM "bank_transaction_fx_rates" newer
		WHERE newer."currency" IN (t."currency", ${base})
			AND newer."rateDate" > t."baseAmountRateDate"
			AND newer."rateDate" <= ${CONVERSION_RATE_DATE_SQL}
	)
)`;
/** Rows a pass converts: unconverted ones, and stand-in ECB amounts whose own rate is now published. */
const TO_CONVERT_SQL = (base: string) => `(${PENDING_SQL} OR ${correctableSql(base)})`;
/**
 * An ECB amount that may still use a stand-in: its rate is older than its day's business day, and for its currency or
 * the reporting currency (`base`) no publication after its day is stored, so neither the day's own rate nor a holiday
 * is known yet. A pass fetches rates for it like for an unconverted row, whatever its age or account.
 */
const unresolvedSql = (base: string) => `(
	t."baseAmountMethod" = 'ECB'
	AND t."baseAmountRateDate" < ${CONVERSION_RATE_DATE_SQL} - CASE EXTRACT(ISODOW FROM ${CONVERSION_RATE_DATE_SQL}) WHEN 6 THEN 1 WHEN 7 THEN 2 ELSE 0 END
	AND EXISTS (
		SELECT 1 FROM (VALUES (t."currency"), (${base})) needed("currency")
		WHERE needed."currency" <> 'EUR' AND NOT EXISTS (
			SELECT 1 FROM "bank_transaction_fx_rates" later
			WHERE later."currency" = needed."currency" AND later."rateDate" > ${CONVERSION_RATE_DATE_SQL}
		)
	)
)`;

/**
 * Rows of alias `t` a conversion pass needs rates for, given the owner's reporting currency (`base`): the ones it
 * converts, and ECB amounts that may still use a stand-in rate.
 */
export const needsConversionRatesSql = (base: string) => `(${TO_CONVERT_SQL(base)} OR ${unresolvedSql(base)})`;

/**
 * Converts every unconverted transaction of one owner into their reporting currency (`$2`), in exact cents:
 * same currency → copied; bank-reported amount in the base currency → `INSTRUCTED`; otherwise via the
 * ECB reference rates (pivoting through EUR) of the newest final publication at most {@link FX_RATE_MAX_AGE_DAYS}
 * days before the transaction, or until that is published the newest stored one, converted again once it is.
 * Rows without a usable rate stay pending and are retried on the next run.
 * The update re-checks the inputs, so a row a concurrent sync changed is left for the next run.
 */
const CONVERT_OWNER_SQL = `
	WITH candidate AS (
		SELECT
			t."id",
			t."amount",
			t."currency",
			t."instructedCurrency",
			t."instructedAmount",
			${CONVERSION_RATE_DATE_SQL} AS "rateDate",
			-- Weekends use Friday's publication; toWeekday in the utils applies the same rule to fetch ranges.
			${CONVERSION_RATE_DATE_SQL} - CASE EXTRACT(ISODOW FROM ${CONVERSION_RATE_DATE_SQL}) WHEN 6 THEN 1 WHEN 7 THEN 2 ELSE 0 END
				AS "businessDate",
			${conversionInputsSql('t')} AS "inputs"
		FROM "bank_transactions" t
		INNER JOIN "bank_accounts" bank_account ON bank_account."id" = t."bankAccountId"
		INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
		WHERE connection."accountId" = $1 AND ${TO_CONVERT_SQL('$2')}
	),
	priced AS (
		SELECT
			candidate.*,
			${ecbRateSql('candidate."currency"', 'source."rateToEur"')} AS "sourceRate",
			${ecbRateSql('$2', 'base."rateToEur"')} AS "baseRate",
			LEAST(source."rateDate", base."rateDate") AS "usedRateDate"
		FROM candidate
		${rateLateral('source', 'candidate."currency"')}
		${rateLateral('base', '$2')}
	),
	method AS (
		SELECT
			priced.*,
			CASE
				WHEN ${inReportingCurrencySql('priced', '$2')} THEN 'SAME'
				WHEN priced."instructedCurrency" = $2 AND priced."instructedAmount" IS NOT NULL THEN 'INSTRUCTED'
				WHEN priced."sourceRate" > 0 AND priced."baseRate" > 0 THEN 'ECB'
			END AS "baseAmountMethod"
		FROM priced
	),
	converted AS (
		SELECT
			method."id",
			method."inputs",
			method."baseAmountMethod",
			CASE method."baseAmountMethod"
				WHEN 'SAME' THEN ${sameCurrencyAmountSql('method')}
				WHEN 'INSTRUCTED' THEN ROUND(SIGN(method."amount") * ABS(method."instructedAmount"), 2)
				WHEN 'ECB' THEN ${convertEcbAmountSql('method."amount"', 'method."sourceRate"', 'method."baseRate"')}
			END AS "amountInBaseCurrency",
			CASE WHEN method."baseAmountMethod" = 'ECB' THEN method."usedRateDate" END AS "baseAmountRateDate"
		FROM method
	),
	updated AS (
		UPDATE "bank_transactions" t
		SET
			"amountInBaseCurrency" = converted."amountInBaseCurrency",
			"baseAmountMethod" = converted."baseAmountMethod",
			"baseAmountRateDate" = converted."baseAmountRateDate",
			"updatedAt" = CURRENT_TIMESTAMP
		FROM converted
		WHERE t."id" = converted."id"
			AND ${TO_CONVERT_SQL('$2')}
			AND ${conversionInputsSql('t')} IS NOT DISTINCT FROM converted."inputs"
			AND converted."baseAmountMethod" IS NOT NULL
			-- A stand-in whose newer rate does not change it yet is left as it is, so it counts as no conversion.
			AND (t."amountInBaseCurrency", t."baseAmountMethod", t."baseAmountRateDate")
				IS DISTINCT FROM (converted."amountInBaseCurrency", converted."baseAmountMethod", converted."baseAmountRateDate")
		RETURNING 1
	)
	SELECT COUNT(*)::integer AS "count" FROM updated`;

/**
 * Converts the owner's rows that need it into `reportingCurrency` with the stored rates (see `CONVERT_OWNER_SQL`) and
 * returns how many it wrote.
 */
export async function convertOwnerAmounts(
	manager: EntityManager,
	ownerId: Account['id'],
	reportingCurrency: string,
): Promise<number> {
	const [result] = await manager.query<Array<{count: number}>>(CONVERT_OWNER_SQL, [
		ownerId,
		reportingCurrency,
		FX_RATE_MAX_AGE_DAYS,
	]);
	return result.count;
}
