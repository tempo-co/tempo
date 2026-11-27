import {BadRequestException, Injectable} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {
	BANK_TRANSACTION_UNCATEGORIZED,
	type BankBalanceTrend,
	type BankBalanceTrendPeriod,
	type BankTransactionCashFlow,
	type BankTransactionCashFlowPeriod,
	type BankTransactionCategoryFilterValue,
	type BankTransactionDayTotals,
	type BankTransactionReviewCounts,
	type BankTransactionSummary,
	type BankTransactionSummaryCategory,
	type BankTransactionTotals,
	type CashFlowInterval,
} from '@tempo/contracts';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_BALANCE_TREND_RANGE,
	BANKING_TRANSACTION_CASH_FLOW_RANGE,
	BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH,
} from '../api/constants/banking-messages.constants';
import type {
	BankBalanceTrendQueryDto,
	BankTransactionCashFlowQueryDto,
} from '../api/dtos/bank-transaction-cash-flow-query.dto';
import type {BankTransactionTotalsQueryDto} from '../api/dtos/bank-transaction-query.dto';
import type {BankTransactionSummaryQueryDto} from '../api/dtos/bank-transaction-summary-query.dto';
import {BankTransaction} from '../bank-transaction.entity';
import {addDays} from '../banking.utils';
import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {type ReportingOwner, totalsCurrency} from '../reporting-currency';
import {
	averageCents,
	buildSpendingPace,
	daysInMonth,
	formatCents,
	nextPeriodStart,
	parseCents,
	periodStarts,
	periodWindows,
	previousMonths,
	summarizeBaseline,
} from '../summary/bank-transaction-summary';
import {convertEcbAmountSql, newestEcbRatePairSql} from './bank-transaction-amount-conversion.utils';
import {
	SQL_BASE_AMOUNT,
	SQL_CATEGORIZATION_FAILED,
	SQL_CATEGORIZING,
	SQL_INCOME,
	SQL_MISSING_BASE_AMOUNT,
	SQL_NEEDS_ATTENTION,
	SQL_OWN_TRANSFER_DEBIT,
	SQL_PERIOD_START,
	SQL_SPENDING,
	applyBankTransactionFilters,
	createOwnerScopedQuery,
	findFirstTransactionDate,
} from './bank-transaction-filters';
import {BANK_CONNECTION_STATUSES} from './banking-sync.constants';

const BASELINE_MONTHS = 3;
/** Keys whose month-to-month average says nothing useful. */
const NO_BASELINE_CATEGORIES = new Set<BankTransactionCategoryFilterValue>([
	'REFUND',
	'NEEDS_REVIEW',
	BANK_TRANSACTION_UNCATEGORIZED,
]);

type FlowRow = {
	month: string;
	day: number;
	flow: 'SPENDING' | 'INCOME';
	category: BankTransactionCategoryFilterValue;
	amount: string;
	count: number;
};
type CategoryTotal = {cents: bigint; count: number};

/** Spending and income as signed cent sums, the way the totals query reads them. */
type TotalsRow = {spending: string; income: string};

function toTotals(row: TotalsRow) {
	const spending = -BigInt(row.spending);
	const income = BigInt(row.income);
	return {spending: formatCents(spending), income: formatCents(income), net: formatCents(income - spending)};
}

@Injectable()
export class BankTransactionSummaryService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		private readonly recurringSeriesService: RecurringSeriesService,
	) {}

	async getSummary(
		owner: ReportingOwner,
		{month, asOf}: BankTransactionSummaryQueryDto,
	): Promise<BankTransactionSummary> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const monthDays = daysInMonth(month);
		const monthStart = `${month}-01`;
		const monthEnd = `${month}-${monthDays}`;
		if (asOf < monthStart) throw new BadRequestException(BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH);
		const through = asOf < monthEnd ? asOf : monthEnd;
		const throughDay = Number(through.slice(8));
		const isPastMonth = month < asOf.slice(0, 7);

		const candidateMonths = previousMonths(month, BASELINE_MONTHS);
		// Flows cover every candidate month; months before the first transaction simply have no rows.
		const [firstTransactionDate, flows, period] = await Promise.all([
			findFirstTransactionDate(this.bankTransactionRepository, accountId),
			this.findFlows(accountId, `${candidateMonths[0]}-01`, through),
			this.findPeriodCounts(accountId, monthStart, through),
		]);
		const baselineMonths = firstTransactionDate
			? candidateMonths.filter(
					(baselineMonth) => `${baselineMonth}-${daysInMonth(baselineMonth)}` >= firstTransactionDate,
				)
			: [];

		const daily = new Map<number, bigint>();
		const categories = new Map<BankTransactionCategoryFilterValue, CategoryTotal>();
		let income = 0n;
		const baselineDaily = new Map(
			baselineMonths.map((baselineMonth) => [baselineMonth, new Map<number, bigint>()]),
		);
		const baselineCategories = new Map<BankTransactionCategoryFilterValue, Map<string, bigint>>();
		const baselineIncome = new Map<string, bigint>();

		for (const row of flows) {
			const cents = parseCents(row.amount);
			const viewed = row.month === month;
			if (row.flow === 'INCOME') {
				if (viewed) income += cents;
				else if (isPastMonth || row.day <= throughDay) addTo(baselineIncome, row.month, cents);
				continue;
			}
			const spending = -cents;
			if (viewed) {
				addTo(daily, row.day, spending);
				const total = categories.get(row.category) ?? {cents: 0n, count: 0};
				categories.set(row.category, {cents: total.cents + spending, count: total.count + row.count});
				continue;
			}
			const monthDaily = baselineDaily.get(row.month);
			// A sync between the queries may add rows before the first transaction date read above.
			if (!monthDaily) continue;
			addTo(monthDaily, row.day, spending);
			if (isPastMonth || row.day <= throughDay) {
				const byMonth = baselineCategories.get(row.category) ?? new Map<string, bigint>();
				baselineCategories.set(row.category, addTo(byMonth, row.month, spending));
			}
		}

		const pace = buildSpendingPace({
			daysInMonth: monthDays,
			throughDay,
			daily,
			baseline: baselineMonths.map((baselineMonth) => ({
				days: daysInMonth(baselineMonth),
				daily: baselineDaily.get(baselineMonth)!,
			})),
		});
		const spending = [...daily.values()].reduce((sum, value) => sum + value, 0n);
		const baselineAverage = (byMonth: ReadonlyMap<string, bigint> | undefined) =>
			formatCents(averageCents(baselineMonths.map((baselineMonth) => byMonth?.get(baselineMonth) ?? 0n)));
		const hasBaseline = baselineMonths.length > 0;
		const usual = !hasBaseline
			? null
			: isPastMonth
				? summarizeBaseline(
						baselineMonths.map((baselineMonth) =>
							[...baselineDaily.get(baselineMonth)!.values()].reduce((sum, value) => sum + value, 0n),
						),
					)
				: pace.baseline[throughDay - 1];

		return {
			month,
			through,
			daysInMonth: monthDays,
			baseCurrency,
			totals: {
				spending: formatCents(spending),
				income: formatCents(income),
				net: formatCents(income - spending),
				ownTransfers: formatCents(parseCents(period.ownTransfers)),
			},
			excluded: {missingBaseAmount: period.missingBaseAmount},
			daily: pace.daily,
			baseline: {
				months: baselineMonths,
				daily: pace.baseline,
				spendingByThrough: usual?.average ?? null,
				spendingRangeByThrough:
					usual?.low != null && usual.high != null ? {low: usual.low, high: usual.high} : null,
				incomeByThrough: hasBaseline ? baselineAverage(baselineIncome) : null,
			},
			categories: [...categories.entries()]
				.sort(compareCategories)
				.map(([category, total]): BankTransactionSummaryCategory => ({
					category,
					spending: formatCents(total.cents),
					count: total.count,
					baselineAverage:
						hasBaseline && !NO_BASELINE_CATEGORIES.has(category)
							? baselineAverage(baselineCategories.get(category))
							: null,
				})),
		};
	}

	async getCashFlow(
		owner: ReportingOwner,
		{interval, from, to, asOf}: BankTransactionCashFlowQueryDto,
	): Promise<BankTransactionCashFlow> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const starts = periodStarts(interval, from, to, asOf);
		if (!starts) throw new BadRequestException(BANKING_TRANSACTION_CASH_FLOW_RANGE);

		const [firstTransactionDate, rows] = await Promise.all([
			findFirstTransactionDate(this.bankTransactionRepository, accountId),
			this.findPeriodFlows(accountId, interval, starts[0], to),
		]);
		const totals = new Map(rows.map((row) => [row.start, row]));
		const periods = periodWindows(interval, starts, to, asOf, firstTransactionDate).map(
			(window): BankTransactionCashFlowPeriod => {
				const spending = -parseCents(totals.get(window.start)?.spending ?? '0');
				const income = parseCents(totals.get(window.start)?.income ?? '0');
				return {
					...window,
					spending: formatCents(spending),
					income: formatCents(income),
					net: formatCents(income - spending),
				};
			},
		);
		return {baseCurrency, interval, periods};
	}

	/**
	 * Combined balance of the owner's connected accounts at the end of each period, rebuilt from each
	 * account's current balance minus the transactions booked after that day. An account counts from its
	 * first booked transaction (or when it was added, if earlier); before that its balance is null.
	 * Foreign balances use the newest ECB rate on or before the period's end. The total is null when an
	 * account that has history by then cannot be converted, so a missing rate never reads as a drop.
	 * Only rows the reported balance holds are subtracted: those booked by the day it was reported, and booked
	 * rows made by that day however late the bank books them (a weekend card payment booked on Monday is in
	 * Sunday's balance). A day from the reported one on is that balance. A hidden account is listed with its balance
	 * but counts in no total, and a period no shown account has history by is left out.
	 */
	async getBalanceTrend(
		owner: ReportingOwner,
		{interval, from, to, asOf}: BankBalanceTrendQueryDto,
	): Promise<BankBalanceTrend> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const starts = periodStarts(interval, from, to, asOf);
		if (!starts) throw new BadRequestException(BANKING_BALANCE_TREND_RANGE);
		const windows = starts.map((start) => {
			const periodEnd = addDays(nextPeriodStart(start, interval), -1);
			return {start, periodEnd, end: periodEnd < to ? periodEnd : to};
		});

		const rows: Array<{id: string; end: string; balance: string | null; included: boolean; hidden: boolean}> =
			await this.bankTransactionRepository.manager.query(
				`
			WITH accounts AS (
				SELECT a."id", a."currency", a."isHidden" AS "hidden", a."currentBalanceAmount" AS "current",
					(a."balanceUpdatedAt" AT TIME ZONE 'UTC')::date AS "reported",
					-- Capped at the owner's today, so an account added late in their day counts today.
					LEAST(
						$5::date,
						(a."createdAt" AT TIME ZONE 'UTC')::date,
						(SELECT MIN(t."bookingDate") FROM "bank_transactions" t WHERE t."bankAccountId" = a."id")
					) AS "first"
				FROM "bank_accounts" a
				JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
				WHERE c."accountId" = $1 AND c."status" = ANY($2::varchar[]) AND a."isActive"
					AND a."currentBalanceAmount" IS NOT NULL
			), native AS (
				SELECT a."id", a."currency", a."hidden", ends."end", ends."end" >= a."first" AS "included",
					-- Only an end the account has history by needs its later bookings summed.
					CASE WHEN ends."end" >= a."first" THEN a."current" - COALESCE((
						SELECT SUM(t."amount") FROM "bank_transactions" t
						WHERE t."bankAccountId" = a."id" AND t."bookingDate" > ends."end"
							AND (a."reported" IS NULL OR t."bookingDate" <= a."reported" OR (
								ends."end" < a."reported" AND t."transactionStatus" = 'BOOK'
								AND t."date" <= a."reported"
							))
					), 0) END AS "amount"
				FROM accounts a CROSS JOIN unnest($3::date[]) AS ends("end")
			)
			SELECT n."id", to_char(n."end", 'YYYY-MM-DD') AS "end", n."included", n."hidden",
				CASE
					WHEN NOT n."included" THEN NULL
					WHEN n."currency" = $4::varchar THEN ROUND(n."amount", 2)
					ELSE ${convertEcbAmountSql('n."amount"', 'rate."source"', 'rate."base"')}
				END::text AS "balance"
			FROM native n
			LEFT JOIN LATERAL (${newestEcbRatePairSql('n."currency"', '$4::varchar', 'n."end"')}) rate ON TRUE
			ORDER BY n."id"`,
				[
					accountId,
					[BANK_CONNECTION_STATUSES.AUTHORIZED, BANK_CONNECTION_STATUSES.EXPIRED],
					windows.map(({end}) => end),
					baseCurrency,
					asOf,
				],
			);

		const byEnd = new Map<string, typeof rows>();
		for (const row of rows) {
			const group = byEnd.get(row.end);
			if (group) group.push(row);
			else byEnd.set(row.end, [row]);
		}
		const periods: BankBalanceTrendPeriod[] = [];
		for (const {start, periodEnd, end} of windows) {
			const accounts = byEnd.get(end) ?? [];
			const counted = accounts.filter((row) => row.included && !row.hidden);
			if (counted.length === 0) continue;
			periods.push({
				start,
				end,
				complete: periodEnd < asOf && periodEnd <= to,
				total: sumBalances(counted),
				accounts: accounts.map((row) => ({id: row.id, balance: row.balance})),
			});
		}
		return {baseCurrency, interval, periods};
	}

	async getTotals(owner: ReportingOwner, {filter}: BankTransactionTotalsQueryDto): Promise<BankTransactionTotals> {
		const row = await (
			await this.createTotalsQuery(owner.id, filter)
		)
			.addSelect('COUNT(*)::int', 'count')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_MISSING_BASE_AMOUNT})::int`, 'missingBaseAmount')
			.getRawOne<TotalsRow & {count: number; missingBaseAmount: number}>();
		return {
			baseCurrency: totalsCurrency(owner),
			...toTotals(row!),
			count: row!.count,
			excluded: {missingBaseAmount: row!.missingBaseAmount},
		};
	}

	/** The totals of each day the filtered list has rows on, newest first, as its day headers show them. */
	async getDayTotals(
		owner: ReportingOwner,
		{filter}: BankTransactionTotalsQueryDto,
	): Promise<BankTransactionDayTotals> {
		const rows = await (
			await this.createTotalsQuery(owner.id, filter)
		)
			.addSelect(`to_char("transaction"."date", 'YYYY-MM-DD')`, 'date')
			.andWhere('"transaction"."date" IS NOT NULL')
			.groupBy('"transaction"."date"')
			.orderBy('"transaction"."date"', 'DESC')
			.getRawMany<TotalsRow & {date: string}>();
		return {baseCurrency: totalsCurrency(owner), days: rows.map((row) => ({date: row.date, ...toTotals(row)}))};
	}

	/** Spending and income in cents over the list's filters; callers add their own grouping. */
	private async createTotalsQuery(accountId: Account['id'], filter: BankTransactionTotalsQueryDto['filter']) {
		const query = createOwnerScopedQuery(this.bankTransactionRepository, accountId);
		const recurringIds = filter?.recurringSeriesKey
			? await this.recurringSeriesService.findTransactionIds(accountId, filter.recurringSeriesKey)
			: undefined;
		applyBankTransactionFilters(query, filter, recurringIds);
		// Round each amount to minor units before summing; never convert monetary SQL results to Number.
		const cents = `ROUND(${SQL_BASE_AMOUNT} * 100)`;
		return query
			.select(`COALESCE(SUM(${cents}) FILTER (WHERE ${SQL_SPENDING}), 0)::text`, 'spending')
			.addSelect(`COALESCE(SUM(${cents}) FILTER (WHERE ${SQL_INCOME}), 0)::text`, 'income');
	}

	async getReviewCounts(accountId: Account['id']): Promise<BankTransactionReviewCounts> {
		const counts = await createOwnerScopedQuery(this.bankTransactionRepository, accountId)
			.select(`COUNT(*) FILTER (WHERE "transaction"."category" = 'NEEDS_REVIEW')::int`, 'needsReview')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_CATEGORIZATION_FAILED})::int`, 'categorizationFailed')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_CATEGORIZING})::int`, 'categorizing')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_MISSING_BASE_AMOUNT})::int`, 'missingBaseAmount')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_NEEDS_ATTENTION})::int`, 'needsAttention')
			.getRawOne<BankTransactionReviewCounts>();
		return counts!;
	}

	/** Spending and income with a base amount, on the same filters a drill link sends, so every number reconciles with the list. */
	private createFlowQuery(accountId: string, from: string, to: string) {
		const query = createOwnerScopedQuery(this.bankTransactionRepository, accountId);
		applyBankTransactionFilters(query, {
			date: {from, to},
			baseAmount: 'PRESENT',
			cashFlows: ['SPENDING', 'INCOME'],
		});
		return query;
	}

	/** Spending and income per month, day and category key; amounts are raw base-currency sums. */
	private findFlows(accountId: string, from: string, to: string): Promise<FlowRow[]> {
		return this.createFlowQuery(accountId, from, to)
			.select(`to_char("transaction"."date", 'YYYY-MM')`, 'month')
			.addSelect('EXTRACT(DAY FROM "transaction"."date")::int', 'day')
			.addSelect(`CASE WHEN ${SQL_SPENDING} THEN 'SPENDING' ELSE 'INCOME' END`, 'flow')
			.addSelect(`COALESCE("transaction"."category", '${BANK_TRANSACTION_UNCATEGORIZED}')`, 'category')
			.addSelect(`ROUND(SUM(${SQL_BASE_AMOUNT}), 2)::text`, 'amount')
			.addSelect('COUNT(*)::int', 'count')
			.groupBy('1')
			.addGroupBy('2')
			.addGroupBy('3')
			.addGroupBy('4')
			.getRawMany<FlowRow>();
	}

	/** Raw signed spending and income sums per period, on the same filters as {@link findFlows}. */
	private findPeriodFlows(accountId: string, interval: CashFlowInterval, from: string, to: string) {
		return this.createFlowQuery(accountId, from, to)
			.select(SQL_PERIOD_START, 'start')
			.addSelect(
				`ROUND(COALESCE(SUM(${SQL_BASE_AMOUNT}) FILTER (WHERE ${SQL_SPENDING}), 0), 2)::text`,
				'spending',
			)
			.addSelect(`ROUND(COALESCE(SUM(${SQL_BASE_AMOUNT}) FILTER (WHERE ${SQL_INCOME}), 0), 2)::text`, 'income')
			.setParameter('interval', interval)
			.groupBy('1')
			.getRawMany<{start: string; spending: string; income: string}>();
	}

	private async findPeriodCounts(accountId: string, from: string, to: string) {
		const query = createOwnerScopedQuery(this.bankTransactionRepository, accountId);
		applyBankTransactionFilters(query, {date: {from, to}});
		const counts = await query
			.select(
				`ROUND(COALESCE(SUM(ABS(${SQL_BASE_AMOUNT})) FILTER (WHERE ${SQL_OWN_TRANSFER_DEBIT}), 0), 2)::text`,
				'ownTransfers',
			)
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_MISSING_BASE_AMOUNT})::int`, 'missingBaseAmount')
			.getRawOne<{ownTransfers: string; missingBaseAmount: number}>();
		return counts!;
	}
}

/** The sum of the balances, or null when any of them could not be converted. */
function sumBalances(rows: Array<{balance: string | null}>): string | null {
	let cents = 0n;
	for (const {balance} of rows) {
		if (balance === null) return null;
		cents += parseCents(balance);
	}
	return formatCents(cents);
}

function addTo<K>(map: Map<K, bigint>, key: K, cents: bigint): Map<K, bigint> {
	return map.set(key, (map.get(key) ?? 0n) + cents);
}

/** Spending descending, then name; refunds always last. */
function compareCategories(
	[leftKey, left]: [BankTransactionCategoryFilterValue, CategoryTotal],
	[rightKey, right]: [BankTransactionCategoryFilterValue, CategoryTotal],
) {
	const refundOrder = Number(leftKey === 'REFUND') - Number(rightKey === 'REFUND');
	if (refundOrder !== 0) return refundOrder;
	if (left.cents !== right.cents) return left.cents > right.cents ? -1 : 1;
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
