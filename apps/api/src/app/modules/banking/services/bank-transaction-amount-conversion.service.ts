import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {DataSource, Repository} from 'typeorm';

import type {Account} from '@modules/account/account.entity';

import {BankAccount} from '../bank-account.entity';
import {BankTransaction} from '../bank-transaction.entity';
import {addDays} from '../banking.utils';
import {lockReportingCurrencyForAmountWrites} from '../reporting-currency';
import {
	FX_RATE_MAX_AGE_DAYS,
	baseAmountInputsSql,
	convertEcbAmountSql,
	ecbRateSql,
	latestExpectedEcbRateDate,
} from './bank-transaction-amount-conversion.utils';
import {CurrencyExchangeService} from './currency-exchange.service';
import {FxRateService} from './fx-rate.service';
import {OwnTransferService} from './own-transfer.service';

/** Dates are null only when no pending row of the currency has a date; such rows can only be copied. */
type PendingCurrency = {
	currency: string;
	fromDate: string | null;
	toDate: string | null;
	count: number;
};

type OwnerToConvert = Pick<Account, 'baseCurrency' | 'baseCurrencyRevision' | 'baseAmountsRevision'> & {
	currencies: PendingCurrency[];
};

/** Rate date of a transaction, as used by the conversion. */
const RATE_DATE_SQL = `COALESCE(t."transactionDate", t."bookingDate")`;
const CURRENCY_SQL = 't."currency"';
/** Rows without a conversion method are (re)converted, including amounts stored before methods were recorded. */
const PENDING_SQL = `t."baseAmountMethod" IS NULL`;

/**
 * The newest reference rate on or before the transaction's rate date that is final: the publication of that
 * date's business day itself, or, once a later publication is stored, the previous one (an ECB holiday).
 * Until then the row waits, so it never keeps an older rate just because the expected one is not out yet.
 * Holidays are inferred, not looked up: a weekday ECB skipped for any other reason is treated the same way.
 */
const rateLateral = (alias: string, currency: string) => `
	LEFT JOIN LATERAL (
		SELECT rate."rateToEur", rate."rateDate"
		FROM "bank_transaction_fx_rates" rate
		WHERE rate."currency" = ${currency}
			AND rate."rateDate" BETWEEN candidate."rateDate" - $3::integer AND candidate."rateDate"
			AND (
				rate."rateDate" = candidate."businessDate"
				OR EXISTS (
					SELECT 1 FROM "bank_transaction_fx_rates" later
					WHERE later."currency" = rate."currency" AND later."rateDate" > candidate."rateDate"
				)
			)
		ORDER BY rate."rateDate" DESC
		LIMIT 1
	) ${alias} ON TRUE`;

/**
 * Converts every unconverted transaction of one owner into their reporting currency (`$2`), in exact cents:
 * same currency → copied; bank-reported amount in the base currency → `INSTRUCTED`; otherwise via the
 * ECB reference rates (pivoting through EUR) of the newest final publication at most {@link FX_RATE_MAX_AGE_DAYS}
 * days before the transaction. Rows without a usable rate stay pending and are retried on the next run.
 * The update re-checks the inputs, so a row a concurrent sync changed is left for the next run.
 */
const CONVERT_OWNER_SQL = `
	WITH candidate AS (
		SELECT
			t."id",
			t."amount",
			${CURRENCY_SQL} AS "currency",
			t."instructedCurrency",
			t."instructedAmount",
			${RATE_DATE_SQL} AS "rateDate",
			-- Weekends use Friday's publication; toWeekday in the utils applies the same rule to fetch ranges.
			${RATE_DATE_SQL} - CASE EXTRACT(ISODOW FROM ${RATE_DATE_SQL}) WHEN 6 THEN 1 WHEN 7 THEN 2 ELSE 0 END
				AS "businessDate",
			${baseAmountInputsSql('t')} AS "inputs"
		FROM "bank_transactions" t
		INNER JOIN "bank_accounts" bank_account ON bank_account."id" = t."bankAccountId"
		INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
		WHERE connection."accountId" = $1 AND ${PENDING_SQL}
	),
	priced AS (
		SELECT
			candidate.*,
			${ecbRateSql('candidate."currency"', 'source."rateToEur"')} AS "sourceRate",
			${ecbRateSql('$2', 'base."rateToEur"')} AS "baseRate",
			GREATEST(source."rateDate", base."rateDate") AS "usedRateDate"
		FROM candidate
		${rateLateral('source', 'candidate."currency"')}
		${rateLateral('base', '$2')}
	),
	method AS (
		SELECT
			priced.*,
			CASE
				WHEN priced."currency" = $2 THEN 'SAME'
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
				WHEN 'SAME' THEN ROUND(method."amount", 2)
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
			AND ${PENDING_SQL}
			AND ${baseAmountInputsSql('t')} IS NOT DISTINCT FROM converted."inputs"
			AND converted."baseAmountMethod" IS NOT NULL
		RETURNING 1
	)
	SELECT COUNT(*)::integer AS "count" FROM updated`;

@Injectable()
export class BankTransactionAmountConversionService {
	private readonly logger = new Logger(BankTransactionAmountConversionService.name);

	constructor(
		private readonly dataSource: DataSource,
		@InjectRepository(BankAccount)
		private readonly bankAccountRepository: Repository<BankAccount>,
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		private readonly fxRateService: FxRateService,
		private readonly currencyExchangeService: CurrencyExchangeService,
		private readonly ownTransferService: OwnTransferService,
	) {}

	/**
	 * One pass over every owner with a reporting currency and either unconverted rows or a currency change to finish.
	 * Owners without a reporting currency wait for one (`ReportingCurrencyService`); this never picks it.
	 */
	async backfill(now = new Date()): Promise<{scanned: number; converted: number}> {
		const latestExpectedDate = latestExpectedEcbRateDate(now);
		await this.refreshAccountCurrencyRates(latestExpectedDate);

		let scanned = 0;
		let converted = 0;
		for (const [accountId, owner] of await this.findOwnersToConvert()) {
			if (!owner.baseCurrency) continue;
			await this.ensureHistoricalRates(owner.currencies, owner.baseCurrency, latestExpectedDate);

			const count = await this.dataSource.transaction(async (manager) => {
				await lockReportingCurrencyForAmountWrites(manager, accountId);
				const [current] = (await manager.query(
					`SELECT "baseCurrency", "baseCurrencyRevision" FROM "accounts" WHERE "id" = $1`,
					[accountId],
				)) as Array<Pick<Account, 'baseCurrency' | 'baseCurrencyRevision'>>;
				// Changed since the rates were fetched: the change queued a pass of its own.
				if (
					current?.baseCurrency !== owner.baseCurrency ||
					current.baseCurrencyRevision !== owner.baseCurrencyRevision
				)
					return null;
				const [result] = (await manager.query(CONVERT_OWNER_SQL, [
					accountId,
					owner.baseCurrency,
					FX_RATE_MAX_AGE_DAYS,
				])) as Array<{count: number}>;
				return result.count;
			});
			if (count === null) continue;
			scanned += owner.currencies.reduce((total, row) => total + row.count, 0);
			converted += count;
			const changed = owner.baseCurrencyRevision !== owner.baseAmountsRevision;
			// Same-day exchanges are matched on base amounts, so new amounts can complete a pairing, and a currency change
			// replaced them all. Own-transfer detection reads no converted amount, only whether a row is an exchange leg,
			// so it follows over the whole history only when a row became or stopped being one, or when that is unknown
			// because the recompute failed.
			if (count > 0 || changed) {
				const reclassifiedIds = await this.currencyExchangeService.recomputeForOwnerSafely(accountId);
				if (reclassifiedIds === null || reclassifiedIds.length > 0)
					await this.ownTransferService.recomputeForOwnerSafely(accountId);
			}
			// Every row this pass could convert is converted: totals are ready, and rows still without a rate (an
			// unsupported currency, a missing or not yet published rate) are reported as left out of them.
			if (changed) {
				await this.dataSource.query(
					`UPDATE "accounts" SET "baseAmountsRevision" = $2 WHERE "id" = $1 AND "baseCurrencyRevision" = $2`,
					[accountId, owner.baseCurrencyRevision],
				);
			}
		}

		this.logger.debug(`Converted ${converted} of ${scanned} bank transaction amounts.`);
		return {scanned, converted};
	}

	/**
	 * Keeps rates current for every active account currency and base currency, even without new transactions,
	 * so the dashboard can show balances in the base currency (dashboard API, phase 1).
	 */
	private async refreshAccountCurrencyRates(latestExpectedDate: string): Promise<void> {
		const rows = (await this.bankAccountRepository.query(
			`SELECT "currency" FROM "bank_accounts" WHERE "isActive" = TRUE
			UNION
			SELECT "baseCurrency" FROM "accounts" WHERE "baseCurrency" IS NOT NULL`,
		)) as Array<{currency: string}>;
		await this.fxRateService.ensureLatestRates(
			rows.map(({currency}) => currency),
			latestExpectedDate,
		);
	}

	/**
	 * Unconverted rows per owner and currency, with the rate-date range each currency needs, plus owners whose
	 * reporting currency changed since the last finished pass (with or without such rows).
	 */
	private async findOwnersToConvert(): Promise<Map<string, OwnerToConvert>> {
		const rows = (await this.bankTransactionRepository.query(
			`SELECT
				connection."accountId",
				${CURRENCY_SQL} AS "currency",
				to_char(MIN(${RATE_DATE_SQL}), 'YYYY-MM-DD') AS "fromDate",
				to_char(MAX(${RATE_DATE_SQL}), 'YYYY-MM-DD') AS "toDate",
				COUNT(*)::integer AS "count"
			FROM "bank_transactions" t
			INNER JOIN "bank_accounts" bank_account ON bank_account."id" = t."bankAccountId"
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			WHERE ${PENDING_SQL}
			GROUP BY connection."accountId", ${CURRENCY_SQL}
			ORDER BY connection."accountId", ${CURRENCY_SQL}`,
		)) as Array<PendingCurrency & {accountId: string}>;
		const owners = (await this.dataSource.query(
			`SELECT "id", "baseCurrency", "baseCurrencyRevision", "baseAmountsRevision" FROM "accounts"
			WHERE "baseCurrency" IS NOT NULL
				AND ("baseCurrencyRevision" <> "baseAmountsRevision" OR "id" = ANY($1::uuid[]))
			ORDER BY "id"`,
			[[...new Set(rows.map(({accountId}) => accountId))]],
		)) as Array<Pick<Account, 'id' | 'baseCurrency' | 'baseCurrencyRevision' | 'baseAmountsRevision'>>;

		const result = new Map<string, OwnerToConvert>(
			owners.map(({id, ...owner}) => [id, {...owner, currencies: []}]),
		);
		for (const {accountId, ...currency} of rows) result.get(accountId)?.currencies.push(currency);
		return result;
	}

	private async ensureHistoricalRates(
		pending: PendingCurrency[],
		baseCurrency: string,
		latestExpectedDate: string,
	): Promise<void> {
		const foreign = pending.filter(
			(row): row is PendingCurrency & {fromDate: string; toDate: string} =>
				row.currency !== baseCurrency && row.fromDate !== null && row.toDate !== null,
		);
		if (foreign.length === 0) return;

		const fromDate = foreign.reduce((min, row) => (row.fromDate < min ? row.fromDate : min), foreign[0].fromDate);
		const toDate = foreign.reduce((max, row) => (row.toDate > max ? row.toDate : max), foreign[0].toDate);
		// Weekend and holiday transactions use the previous publication, so fetch from before the first date.
		// A holiday row also needs a later publication to show the day had none, so fetch past the last date,
		// up to the newest rate that should already be published.
		const fetchUntil = addDays(toDate, FX_RATE_MAX_AGE_DAYS);
		await this.fxRateService.ensureRates(
			[...foreign.map(({currency}) => currency), baseCurrency],
			addDays(fromDate, -FX_RATE_MAX_AGE_DAYS),
			fetchUntil < latestExpectedDate ? fetchUntil : latestExpectedDate,
		);
	}
}
