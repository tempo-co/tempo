import {BadRequestException, Injectable, Logger} from '@nestjs/common';
import {REPORTING_CURRENCIES, type ReportingCurrency} from '@tempo/contracts';
import {DataSource, EntityManager} from 'typeorm';

import {dateInAppTimeZone} from '@core/time/app-time-zone';
import {Account, BaseCurrencyState} from '@modules/account/account.entity';

import {REPORTING_CURRENCY_UNSUPPORTED} from '../api/constants/banking-messages.constants';
import {addDays, safeErrorName} from '../banking.utils';
import {lockReportingCurrencyForChange} from '../reporting-currency';
import {BankTransactionAmountConversionQueueService} from './bank-transaction-amount-conversion.queue.service';
import {MAX_ECB_PUBLICATION_GAP_DAYS} from './bank-transaction-amount-conversion.utils';
import {SQL_INTERNAL} from './bank-transaction-filters';

/** How far back the suggestion counts transactions. A starting point, not a measured optimum. */
export const SUGGESTION_WINDOW_DAYS = 90;

/**
 * A currency whose newest stored rate is this many days older than the newest rate of any currency has stopped being
 * published: twice the longest gap between ECB publications ({@link MAX_ECB_PUBLICATION_GAP_DAYS}).
 */
export const RATES_STOPPED_AFTER_DAYS = 2 * MAX_ECB_PUBLICATION_GAP_DAYS;

const SUPPORTED: ReadonlySet<string> = new Set(REPORTING_CURRENCIES);
const CHOSEN_STATES: ReadonlySet<BaseCurrencyState | null> = new Set(['CONFIRMED', 'PRESET']);

/** Booked transactions per currency in the window, leaving out own transfers and currency exchanges. */
const SUGGESTION_SQL = `
	SELECT "transaction"."currency", COUNT(*)::integer AS "count"
	FROM "bank_transactions" "transaction"
	INNER JOIN "bank_accounts" bank_account ON bank_account."id" = "transaction"."bankAccountId"
	INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
	WHERE connection."accountId" = $1
		AND UPPER(BTRIM(COALESCE("transaction"."transactionStatus", ''))) <> 'PDNG'
		AND COALESCE("transaction"."bookingDate", "transaction"."transactionDate") BETWEEN $2::date AND $3::date
		AND NOT ${SQL_INTERNAL}
		AND "transaction"."currency" = ANY($4::text[])
	GROUP BY "transaction"."currency"
	ORDER BY "count" DESC, "transaction"."currency"
	LIMIT 2`;

/** The newest stored rate of a currency (`$1`), and the newest of any currency when that one is older than `$2`. */
const NEWEST_RATES_SQL = `
	WITH own AS (SELECT MAX("rateDate") AS "rateDate" FROM "bank_transaction_fx_rates" WHERE "currency" = $1)
	SELECT
		to_char(own."rateDate", 'YYYY-MM-DD') AS "own",
		CASE WHEN own."rateDate" < $2::date
			THEN (SELECT to_char(MAX("rateDate"), 'YYYY-MM-DD') FROM "bank_transaction_fx_rates")
		END AS "newest"
	FROM own`;

/**
 * The owner's reporting currency: the one currency every combined total is in.
 *
 * - While every active account holds one currency, Tempo uses it (`AUTOMATIC`), as soon as the accounts are known,
 *   and follows it while the owner has not chosen one.
 * - Once accounts hold several and a sync or import has finished, the owner is asked once (`SETUP_PENDING`) and
 *   nothing is guessed: an automatic currency stays meanwhile, and without one, the currency most recent transactions
 *   are in is only suggested.
 * - A chosen currency (`CONFIRMED`, or `PRESET` from before owners could choose) never changes by itself. Once Tempo
 *   can no longer convert into the current currency (see {@link convertsInto}), the owner is asked again.
 *
 * Changing it clears every converted amount in the same transaction and lets the conversion job convert them again.
 */
@Injectable()
export class ReportingCurrencyService {
	private readonly logger = new Logger(ReportingCurrencyService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly conversionQueue: BankTransactionAmountConversionQueueService,
	) {}

	async get(ownerId: Account['id'], now = new Date()): Promise<ReportingCurrency> {
		const manager = this.dataSource.manager;
		const account = await manager.getRepository(Account).findOneByOrFail({id: ownerId});
		const connectedCurrencies = await findConnectedCurrencies(manager, ownerId);
		const state = stateOf(account);
		const currencyUnavailable =
			account.baseCurrency !== null && !(await convertsInto(manager, account.baseCurrency, now));
		const setupRequired = state === 'SETUP_PENDING' || currencyUnavailable;
		const suggestion =
			setupRequired && (account.baseCurrency === null || currencyUnavailable)
				? await this.findSuggestion(manager, ownerId, now, account.baseCurrency)
				: null;
		const first = connectedCurrencies.filter(
			(currency) => SUPPORTED.has(currency) && !(currencyUnavailable && currency === account.baseCurrency),
		);
		return {
			currency: account.baseCurrency,
			confirmed: CHOSEN_STATES.has(state) && !currencyUnavailable,
			setupRequired,
			currencyUnavailable,
			suggestion,
			connectedCurrencies,
			options: [
				...first,
				...REPORTING_CURRENCIES.filter(
					(currency) =>
						!first.includes(currency) && !(currencyUnavailable && currency === account.baseCurrency),
				),
			],
			recalculating: account.baseCurrencyRevision !== account.baseAmountsRevision,
		};
	}

	/**
	 * Saves the owner's choice. Choosing the current currency only confirms it; another one is converted to from
	 * scratch. A currency Tempo can't convert into (see {@link convertsInto}) is refused, also the current one.
	 */
	async choose(ownerId: Account['id'], currency: string): Promise<ReportingCurrency> {
		const revision = await this.dataSource.transaction(async (manager) => {
			await lockReportingCurrencyForChange(manager, ownerId);
			const account = await manager
				.getRepository(Account)
				.findOneOrFail({where: {id: ownerId}, lock: {mode: 'pessimistic_write'}});
			if (!(await convertsInto(manager, currency))) throw new BadRequestException(REPORTING_CURRENCY_UNSUPPORTED);
			if (currency === account.baseCurrency) {
				await manager.getRepository(Account).update({id: ownerId}, {baseCurrencyState: 'CONFIRMED'});
				return null;
			}
			return changeBaseCurrency(manager, ownerId, currency, 'CONFIRMED');
		});
		if (revision !== null) await this.enqueueConversion(ownerId, revision);
		return this.get(ownerId);
	}

	/**
	 * Brings the state up to date with the owner's active accounts, after anything that adds, removes or fills them
	 * (authorization, sync, import, removal). `historySettled` says a sync or import of history has finished, so the
	 * owner can be asked now; an authorization only knows the accounts. After a sync or import it also converts the
	 * rows it wrote right away, rather than at the next 15-minute run. Never throws: the next event retries.
	 */
	async reconcileSafely(ownerId: Account['id'], {historySettled}: {historySettled: boolean}): Promise<void> {
		try {
			const revision = await this.dataSource.transaction(async (manager) => {
				await lockReportingCurrencyForChange(manager, ownerId);
				const account = await manager
					.getRepository(Account)
					.findOne({where: {id: ownerId}, lock: {mode: 'pessimistic_write'}});
				if (!account) return null;
				const state = stateOf(account);
				if (CHOSEN_STATES.has(state)) return null;
				const currencies = await findConnectedCurrencies(manager, ownerId);
				// Unchosen, the currency follows the accounts' only one, also once others are gone and nothing is left to ask.
				if (currencies.length === 1) {
					if (account.baseCurrency !== currencies[0]) {
						return changeBaseCurrency(manager, ownerId, currencies[0], 'AUTOMATIC');
					}
					if (state !== 'AUTOMATIC') {
						await manager.getRepository(Account).update({id: ownerId}, {baseCurrencyState: 'AUTOMATIC'});
					}
				} else if (currencies.length > 1 && historySettled && state !== 'SETUP_PENDING') {
					await manager.getRepository(Account).update({id: ownerId}, {baseCurrencyState: 'SETUP_PENDING'});
				} else if (currencies.length === 0 && state === 'SETUP_PENDING') {
					// No accounts left to ask about; the next ones decide again.
					await manager
						.getRepository(Account)
						.update({id: ownerId}, {baseCurrencyState: account.baseCurrency === null ? null : 'AUTOMATIC'});
				}
				return null;
			});
			if (revision !== null) await this.enqueueConversion(ownerId, revision);
			else if (historySettled) await this.enqueueConversion(ownerId, 'rows');
		} catch (error) {
			this.logger.warn(`Reporting currency reconciliation failed: ${safeErrorName(error)}`);
		}
	}

	/**
	 * The single currency most recent booked transactions are in, other than `current` (one Tempo can no longer
	 * convert into); null on a tie or without any.
	 */
	private async findSuggestion(
		manager: EntityManager,
		ownerId: string,
		now: Date,
		current: string | null,
	): Promise<string | null> {
		const today = dateInAppTimeZone(now);
		const rows = (await manager.query(SUGGESTION_SQL, [
			ownerId,
			addDays(today, -SUGGESTION_WINDOW_DAYS),
			today,
			[...SUPPORTED].filter((currency) => currency !== current),
		])) as Array<{currency: string; count: number}>;
		if (rows.length === 0 || rows[1]?.count === rows[0].count) return null;
		return rows[0].currency;
	}

	/** The 15-minute conversion run catches up if this fails. */
	private async enqueueConversion(ownerId: string, reason: number | 'rows'): Promise<void> {
		try {
			await this.conversionQueue.enqueueConversion(`${ownerId}-${reason}`);
		} catch (error) {
			this.logger.warn(`Amount conversion enqueue failed: ${safeErrorName(error)}`);
		}
	}
}

/**
 * Whether amounts can still be converted into a currency: EUR, or one the ECB publishes. That is one of
 * {@link REPORTING_CURRENCIES}, unless its stored rates stopped while others' went on, which catches a currency the ECB
 * stops publishing before that list knows. A currency with no stored rate yet counts as published.
 */
async function convertsInto(manager: EntityManager, currency: string, now = new Date()): Promise<boolean> {
	if (currency === 'EUR') return true;
	if (!SUPPORTED.has(currency)) return false;
	const [{own, newest}] = (await manager.query(NEWEST_RATES_SQL, [
		currency,
		addDays(dateInAppTimeZone(now), -RATES_STOPPED_AFTER_DAYS),
	])) as Array<{own: string | null; newest: string | null}>;
	return own === null || newest === null || own >= addDays(newest, -RATES_STOPPED_AFTER_DAYS);
}

/** A currency stored without a state was set before owners could choose one (`PRESET`). */
function stateOf({baseCurrency, baseCurrencyState}: Account): BaseCurrencyState | null {
	return baseCurrencyState ?? (baseCurrency === null ? null : 'PRESET');
}

async function findConnectedCurrencies(manager: EntityManager, ownerId: string): Promise<string[]> {
	const rows = (await manager.query(
		`SELECT DISTINCT UPPER(BTRIM(bank_account."currency")) AS "currency"
		FROM "bank_accounts" bank_account
		INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
		WHERE connection."accountId" = $1 AND bank_account."isActive" = TRUE AND BTRIM(bank_account."currency") <> ''
		ORDER BY 1`,
		[ownerId],
	)) as Array<{currency: string}>;
	return rows.map(({currency}) => currency);
}

/**
 * Sets a new reporting currency and clears every converted amount of the owner, copying the ones already in it, so no
 * amount is ever read as the new currency while it is in the old one. When amounts are left to convert, bumps the
 * revision the conversion job has to finish before totals are ready again and returns it; otherwise the totals are
 * complete at once and it returns null. Runs under {@link lockReportingCurrencyForChange}.
 */
async function changeBaseCurrency(
	manager: EntityManager,
	ownerId: string,
	currency: string,
	state: BaseCurrencyState,
): Promise<number | null> {
	await manager.query(
		`UPDATE "accounts" SET "baseCurrency" = $2, "baseCurrencyState" = $3, "updatedAt" = CURRENT_TIMESTAMP
		WHERE "id" = $1`,
		[ownerId, currency, state],
	);
	await manager.query(
		`UPDATE "bank_transactions" t
		SET "amountInBaseCurrency" = CASE WHEN t."currency" = $2 THEN ROUND(t."amount", 2) END,
			"baseAmountMethod" = CASE WHEN t."currency" = $2 THEN 'SAME' END,
			"baseAmountRateDate" = NULL,
			"updatedAt" = CURRENT_TIMESTAMP
		FROM "bank_accounts" bank_account
		INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
		WHERE t."bankAccountId" = bank_account."id" AND connection."accountId" = $1
			AND (t."baseAmountMethod" IS NOT NULL OR t."currency" = $2)`,
		[ownerId, currency],
	);
	const [{toConvert}] = (await manager.query(
		`SELECT EXISTS (
			SELECT 1 FROM "bank_transactions" t
			INNER JOIN "bank_accounts" bank_account ON bank_account."id" = t."bankAccountId"
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			WHERE connection."accountId" = $1 AND t."baseAmountMethod" IS NULL
		) AS "toConvert"`,
		[ownerId],
	)) as Array<{toConvert: boolean}>;
	if (!toConvert) {
		// Also finishes an earlier change still waiting for its conversion pass: nothing is left for it to convert.
		await manager.query(`UPDATE "accounts" SET "baseAmountsRevision" = "baseCurrencyRevision" WHERE "id" = $1`, [
			ownerId,
		]);
		return null;
	}
	// TypeORM answers an UPDATE on PostgreSQL with [rows, affected].
	const [[{baseCurrencyRevision}]] = (await manager.query(
		`UPDATE "accounts" SET "baseCurrencyRevision" = "baseCurrencyRevision" + 1 WHERE "id" = $1
		RETURNING "baseCurrencyRevision"`,
		[ownerId],
	)) as [Array<{baseCurrencyRevision: number}>, number];
	return baseCurrencyRevision;
}
