import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {DataSource, Repository} from 'typeorm';

import type {Account} from '@modules/account/account.entity';

import {BankAccount} from '../bank-account.entity';
import {BankTransaction} from '../bank-transaction.entity';
import {addDays} from '../banking.utils';
import {CONVERSION_RATE_DATE_SQL, convertOwnerAmounts, needsConversionRatesSql} from '../converted-amounts';
import {lockReportingCurrencyForAmountWrites} from '../reporting-currency';
import {FX_RATE_MAX_AGE_DAYS, latestExpectedEcbRateDate} from './bank-transaction-amount-conversion.utils';
import {DerivedDataRefreshService} from './derived-data-refresh.service';
import {FxRateService} from './fx-rate.service';

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

const CURRENCY_SQL = 't."currency"';

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
		private readonly derivedDataRefreshService: DerivedDataRefreshService,
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
			const {baseCurrency} = owner;
			if (!baseCurrency) continue;
			await this.ensureHistoricalRates(owner.currencies, baseCurrency, latestExpectedDate);

			const count = await this.dataSource.transaction(async (manager) => {
				await lockReportingCurrencyForAmountWrites(manager, accountId);
				const [current] = await manager.query<Array<Pick<Account, 'baseCurrency' | 'baseCurrencyRevision'>>>(
					`SELECT "baseCurrency", "baseCurrencyRevision" FROM "accounts" WHERE "id" = $1`,
					[accountId],
				);
				// Changed since the rates were fetched: the change queued a pass of its own.
				if (
					current?.baseCurrency !== baseCurrency ||
					current.baseCurrencyRevision !== owner.baseCurrencyRevision
				)
					return null;
				return convertOwnerAmounts(manager, accountId, baseCurrency);
			});
			if (count === null) continue;
			scanned += owner.currencies.reduce((total, row) => total + row.count, 0);
			converted += count;
			const changed = owner.baseCurrencyRevision !== owner.baseAmountsRevision;
			await this.derivedDataRefreshService.refresh(accountId, {
				kind: 'converted-amounts',
				amountsConverted: count > 0,
				reportingCurrencyChanged: changed,
			});
			// Every row this pass could convert is converted: totals are ready, and rows still without a rate (an
			// unsupported currency, or none stored within a week before the row) are reported as left out of them.
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
		const rows = await this.bankAccountRepository.query<Array<{currency: string}>>(
			`SELECT "currency" FROM "bank_accounts" WHERE "isActive" = TRUE
			UNION
			SELECT "baseCurrency" FROM "accounts" WHERE "baseCurrency" IS NOT NULL`,
		);
		await this.fxRateService.ensureLatestRates(
			rows.map(({currency}) => currency),
			latestExpectedDate,
		);
	}

	/**
	 * Rows to convert or still on a stand-in rate, per owner and currency, with the rate-date range each currency needs
	 * (fetched before the pass), plus owners whose reporting currency changed since the last finished pass (with or
	 * without such rows).
	 */
	private async findOwnersToConvert(): Promise<Map<string, OwnerToConvert>> {
		const rows = await this.bankTransactionRepository.query<Array<PendingCurrency & {accountId: string}>>(
			`SELECT
				connection."accountId",
				${CURRENCY_SQL} AS "currency",
				to_char(MIN(${CONVERSION_RATE_DATE_SQL}), 'YYYY-MM-DD') AS "fromDate",
				to_char(MAX(${CONVERSION_RATE_DATE_SQL}), 'YYYY-MM-DD') AS "toDate",
				COUNT(*)::integer AS "count"
			FROM "bank_transactions" t
			INNER JOIN "bank_accounts" bank_account ON bank_account."id" = t."bankAccountId"
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			INNER JOIN "accounts" owner ON owner."id" = connection."accountId"
			WHERE ${needsConversionRatesSql('owner."baseCurrency"')}
			GROUP BY connection."accountId", ${CURRENCY_SQL}
			ORDER BY connection."accountId", ${CURRENCY_SQL}`,
		);
		const owners = await this.dataSource.query<
			Array<Pick<Account, 'id' | 'baseCurrency' | 'baseCurrencyRevision' | 'baseAmountsRevision'>>
		>(
			`SELECT "id", "baseCurrency", "baseCurrencyRevision", "baseAmountsRevision" FROM "accounts"
			WHERE "baseCurrency" IS NOT NULL
				AND ("baseCurrencyRevision" <> "baseAmountsRevision" OR "id" = ANY($1::uuid[]))
			ORDER BY "id"`,
			[[...new Set(rows.map(({accountId}) => accountId))]],
		);

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
