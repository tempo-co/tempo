import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankAccount} from '../bank-account.entity';
import {BankTransaction} from '../bank-transaction.entity';
import {addDays} from '../banking.utils';
import {
	FX_RATE_MAX_AGE_DAYS,
	baseAmountInputsSql,
	convertEcbAmountSql,
	ecbRateSql,
	latestExpectedEcbRateDate,
	normalizeCurrency,
} from './bank-transaction-amount-conversion.utils';
import {CurrencyExchangeService} from './currency-exchange.service';
import {FxRateService} from './fx-rate.service';

const DEFAULT_BASE_CURRENCY = 'EUR';

/** Dates are null only when no pending row of the currency has a date; such rows can only be copied. */
type PendingCurrency = {
	currency: string;
	fromDate: string | null;
	toDate: string | null;
	count: number;
};

type PendingOwner = {baseCurrency: string | null; currencies: PendingCurrency[]};

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
 * Converts every unconverted transaction of one owner into their base currency, in exact cents:
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
		@InjectRepository(Account)
		private readonly accountRepository: Repository<Account>,
		@InjectRepository(BankAccount)
		private readonly bankAccountRepository: Repository<BankAccount>,
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		private readonly fxRateService: FxRateService,
		private readonly currencyExchangeService: CurrencyExchangeService,
	) {}

	async backfill(now = new Date()): Promise<{scanned: number; converted: number}> {
		const latestExpectedDate = latestExpectedEcbRateDate(now);
		await this.refreshAccountCurrencyRates(latestExpectedDate);

		let scanned = 0;
		let converted = 0;
		for (const [accountId, owner] of await this.findPendingOwners()) {
			const baseCurrency = await this.resolveBaseCurrency(accountId, owner.baseCurrency);
			await this.ensureHistoricalRates(owner.currencies, baseCurrency, latestExpectedDate);

			const [{count}] = (await this.bankTransactionRepository.query(CONVERT_OWNER_SQL, [
				accountId,
				baseCurrency,
				FX_RATE_MAX_AGE_DAYS,
			])) as Array<{count: number}>;
			scanned += owner.currencies.reduce((total, row) => total + row.count, 0);
			converted += count;
			// Same-day exchanges are matched on base amounts, so new amounts can complete a pairing.
			if (count > 0) await this.currencyExchangeService.recomputeForOwnerSafely(accountId);
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

	/** Unconverted rows per owner and currency, with the rate-date range each currency needs. */
	private async findPendingOwners(): Promise<Map<string, PendingOwner>> {
		const rows = (await this.bankTransactionRepository.query(
			`SELECT
				connection."accountId",
				account."baseCurrency",
				${CURRENCY_SQL} AS "currency",
				to_char(MIN(${RATE_DATE_SQL}), 'YYYY-MM-DD') AS "fromDate",
				to_char(MAX(${RATE_DATE_SQL}), 'YYYY-MM-DD') AS "toDate",
				COUNT(*)::integer AS "count"
			FROM "bank_transactions" t
			INNER JOIN "bank_accounts" bank_account ON bank_account."id" = t."bankAccountId"
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			INNER JOIN "accounts" account ON account."id" = connection."accountId"
			WHERE ${PENDING_SQL}
			GROUP BY connection."accountId", account."baseCurrency", ${CURRENCY_SQL}
			ORDER BY connection."accountId", ${CURRENCY_SQL}`,
		)) as Array<PendingCurrency & {accountId: string; baseCurrency: string | null}>;

		const owners = new Map<string, PendingOwner>();
		for (const {accountId, baseCurrency, ...currency} of rows) {
			const owner = owners.get(accountId) ?? {baseCurrency, currencies: []};
			owner.currencies.push(currency);
			owners.set(accountId, owner);
		}
		return owners;
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

	private async resolveBaseCurrency(accountId: string, storedBaseCurrency: string | null): Promise<string> {
		if (storedBaseCurrency) return storedBaseCurrency;

		const preferredAccount = await this.bankAccountRepository
			.createQueryBuilder('bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.innerJoin('connection.account', 'account')
			.where('account.id = :accountId', {accountId})
			.andWhere('bankAccount.isActive = TRUE')
			.select('bankAccount.currency', 'currency')
			.addSelect('COUNT(*)', 'count')
			.groupBy('bankAccount.currency')
			.orderBy('COUNT(*)', 'DESC')
			.addOrderBy('bankAccount.currency', 'ASC')
			.getRawOne<{currency?: string}>();
		const baseCurrency = normalizeCurrency(preferredAccount?.currency) ?? DEFAULT_BASE_CURRENCY;
		await this.accountRepository.update({id: accountId}, {baseCurrency});
		return baseCurrency;
	}
}
