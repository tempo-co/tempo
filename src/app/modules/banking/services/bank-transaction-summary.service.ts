import {BadRequestException, Injectable} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_BALANCE_TREND_RANGE,
	BANKING_TRANSACTION_CASH_FLOW_RANGE,
	BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH,
} from '../api/constants/banking-messages.constants';
import type {BankTransactionCashFlowQueryDto, CashFlowInterval} from '../api/dtos/bank-transaction-cash-flow-query.dto';
import type {BankTransactionSummaryQueryDto} from '../api/dtos/bank-transaction-summary-query.dto';
import type {
	BankBalanceTrendPeriodDto,
	BankBalanceTrendResponseDto,
	BankTransactionCashFlowPeriodDto,
	BankTransactionCashFlowResponseDto,
	BankTransactionReviewCountsResponseDto,
	BankTransactionSummaryCategoryDto,
	BankTransactionSummaryResponseDto,
} from '../api/dtos/bank-transaction-summary-response.dto';
import {BankTransaction} from '../bank-transaction.entity';
import {
	BANK_TRANSACTION_UNCATEGORIZED,
	type BankTransactionCategoryFilterValue,
} from '../categorization/bank-transaction-category';
import {
	averageCents,
	buildSpendingPace,
	daysInMonth,
	formatCents,
	parseCents,
	previousMonths,
	summarizeBaseline,
} from '../summary/bank-transaction-summary';
import {convertEcbAmountSql, newestEcbRatePairSql} from './bank-transaction-amount-conversion.utils';
import {
	SQL_CATEGORIZATION_FAILED,
	SQL_CATEGORIZING,
	SQL_INCOME,
	SQL_MISSING_BASE_AMOUNT,
	SQL_OWN_TRANSFER_DEBIT,
	SQL_SPENDING,
	SQL_UNKNOWN_DIRECTION,
	applyBankTransactionFilters,
} from './bank-transaction-filters';
import {BANK_CONNECTION_STATUSES} from './banking-sync.constants';

const BASELINE_MONTHS = 3;
const CASH_FLOW_MAX_PERIODS: Record<CashFlowInterval, number> = {week: 104, month: 60, year: 10};
const BASE_AMOUNT = '"transaction"."amountInBaseCurrency"';
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

@Injectable()
export class BankTransactionSummaryService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
	) {}

	async getSummary(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		{month, asOf}: BankTransactionSummaryQueryDto,
	): Promise<BankTransactionSummaryResponseDto> {
		const monthDays = daysInMonth(month);
		const monthStart = `${month}-01`;
		const monthEnd = `${month}-${monthDays}`;
		if (asOf < monthStart) throw new BadRequestException(BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH);
		const through = asOf < monthEnd ? asOf : monthEnd;
		const throughDay = Number(through.slice(8));
		const isPastMonth = month < asOf.slice(0, 7);

		const candidateMonths = previousMonths(month, BASELINE_MONTHS);
		// Flows cover every candidate month; months before the first booking simply have no rows.
		const [firstBookingDate, flows, period] = await Promise.all([
			this.findFirstBookingDate(accountId),
			this.findFlows(accountId, `${candidateMonths[0]}-01`, through),
			this.findPeriodCounts(accountId, monthStart, through),
		]);
		const baselineMonths = firstBookingDate
			? candidateMonths.filter(
					(baselineMonth) => `${baselineMonth}-${daysInMonth(baselineMonth)}` >= firstBookingDate,
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
			// A sync between the queries may add rows before the first booking date read above.
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
			excluded: {unknownDirection: period.unknownDirection, missingBaseAmount: period.missingBaseAmount},
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
				.map(([category, total]): BankTransactionSummaryCategoryDto => ({
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
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		{interval, from, to, asOf}: BankTransactionCashFlowQueryDto,
	): Promise<BankTransactionCashFlowResponseDto> {
		const starts = periodStarts(interval, from, to, asOf);
		if (!starts) throw new BadRequestException(BANKING_TRANSACTION_CASH_FLOW_RANGE);

		const [firstBookingDate, rows] = await Promise.all([
			this.findFirstBookingDate(accountId),
			this.findPeriodFlows(accountId, interval, starts[0], to),
		]);
		const totals = new Map(rows.map((row) => [row.start, row]));
		const periods: BankTransactionCashFlowPeriodDto[] = [];
		for (const start of starts) {
			const periodEnd = addDays(nextPeriodStart(start, interval), -1);
			if (!firstBookingDate || periodEnd < firstBookingDate) continue;
			const spending = -parseCents(totals.get(start)?.spending ?? '0');
			const income = parseCents(totals.get(start)?.income ?? '0');
			periods.push({
				start,
				end: periodEnd < to ? periodEnd : to,
				// A period that ends today is still running; one cut by where history starts is partial.
				complete: periodEnd < asOf && periodEnd <= to && start >= firstBookingDate,
				spending: formatCents(spending),
				income: formatCents(income),
				net: formatCents(income - spending),
			});
		}
		return {baseCurrency, interval, periods};
	}

	/**
	 * Combined balance of the owner's connected accounts at the end of each period, rebuilt from each
	 * account's current balance minus the transactions booked after that day. An account counts from its
	 * first booked transaction (or when it was added, if earlier); before that its balance is null.
	 * Foreign balances use the newest ECB rate on or before the period's end. The total is null when an
	 * account that has history by then cannot be converted, so a missing rate never reads as a drop.
	 * Only bookings up to the day the balance was reported are subtracted; later ones are not in it yet.
	 */
	async getBalanceTrend(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		{interval, from, to, asOf}: BankTransactionCashFlowQueryDto,
	): Promise<BankBalanceTrendResponseDto> {
		const starts = periodStarts(interval, from, to, asOf);
		if (!starts) throw new BadRequestException(BANKING_BALANCE_TREND_RANGE);
		const windows = starts.map((start) => {
			const periodEnd = addDays(nextPeriodStart(start, interval), -1);
			return {start, periodEnd, end: periodEnd < to ? periodEnd : to};
		});

		const rows: Array<{id: string; end: string; balance: string | null; included: boolean}> =
			await this.bankTransactionRepository.manager.query(
				`
			WITH accounts AS (
				SELECT a."id", a."currency", a."currentBalanceAmount" AS "current",
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
				SELECT a."id", a."currency", ends."end", ends."end" >= a."first" AS "included",
					a."current" - COALESCE((
						SELECT SUM(t."amount") FROM "bank_transactions" t
						WHERE t."bankAccountId" = a."id" AND t."bookingDate" > ends."end"
							AND (a."reported" IS NULL OR t."bookingDate" <= a."reported")
					), 0) AS "amount"
				FROM accounts a CROSS JOIN unnest($3::date[]) AS ends("end")
			)
			SELECT n."id", to_char(n."end", 'YYYY-MM-DD') AS "end", n."included",
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
		const periods: BankBalanceTrendPeriodDto[] = [];
		for (const {start, periodEnd, end} of windows) {
			const accounts = byEnd.get(end) ?? [];
			const counted = accounts.filter((row) => row.included);
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

	async getReviewCounts(accountId: Account['id']): Promise<BankTransactionReviewCountsResponseDto> {
		const counts = await this.createOwnerScopedQuery(accountId)
			.select(`COUNT(*) FILTER (WHERE "transaction"."category" = 'NEEDS_REVIEW')::int`, 'needsReview')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_CATEGORIZATION_FAILED})::int`, 'categorizationFailed')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_CATEGORIZING})::int`, 'categorizing')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_UNKNOWN_DIRECTION})::int`, 'unknownDirection')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_MISSING_BASE_AMOUNT})::int`, 'missingBaseAmount')
			.getRawOne<BankTransactionReviewCountsResponseDto>();
		return counts!;
	}

	/** Spending and income per month, day and category key; amounts are raw base-currency sums. */
	private findFlows(accountId: string, from: string, to: string): Promise<FlowRow[]> {
		// The same filters a drill link sends, so every number reconciles with the list.
		const query = this.createOwnerScopedQuery(accountId);
		applyBankTransactionFilters(query, {
			bookingDate: {from, to},
			baseAmount: 'PRESENT',
			cashFlows: ['SPENDING', 'INCOME'],
		});
		return query
			.select(`to_char("transaction"."bookingDate", 'YYYY-MM')`, 'month')
			.addSelect('EXTRACT(DAY FROM "transaction"."bookingDate")::int', 'day')
			.addSelect(`CASE WHEN ${SQL_SPENDING} THEN 'SPENDING' ELSE 'INCOME' END`, 'flow')
			.addSelect(`COALESCE("transaction"."category", '${BANK_TRANSACTION_UNCATEGORIZED}')`, 'category')
			.addSelect(`ROUND(SUM(${BASE_AMOUNT}), 2)::text`, 'amount')
			.addSelect('COUNT(*)::int', 'count')
			.groupBy('1')
			.addGroupBy('2')
			.addGroupBy('3')
			.addGroupBy('4')
			.getRawMany<FlowRow>();
	}

	/** Raw signed spending and income sums per period, on the same filters as {@link findFlows}. */
	private findPeriodFlows(accountId: string, interval: CashFlowInterval, from: string, to: string) {
		const query = this.createOwnerScopedQuery(accountId);
		applyBankTransactionFilters(query, {
			bookingDate: {from, to},
			baseAmount: 'PRESENT',
			cashFlows: ['SPENDING', 'INCOME'],
		});
		return query
			.select(`to_char(date_trunc(:interval, "transaction"."bookingDate"::timestamp), 'YYYY-MM-DD')`, 'start')
			.addSelect(`ROUND(COALESCE(SUM(${BASE_AMOUNT}) FILTER (WHERE ${SQL_SPENDING}), 0), 2)::text`, 'spending')
			.addSelect(`ROUND(COALESCE(SUM(${BASE_AMOUNT}) FILTER (WHERE ${SQL_INCOME}), 0), 2)::text`, 'income')
			.setParameter('interval', interval)
			.groupBy('1')
			.getRawMany<{start: string; spending: string; income: string}>();
	}

	private async findPeriodCounts(accountId: string, from: string, to: string) {
		const query = this.createOwnerScopedQuery(accountId);
		applyBankTransactionFilters(query, {bookingDate: {from, to}});
		const counts = await query
			.select(
				`ROUND(COALESCE(SUM(ABS(${BASE_AMOUNT})) FILTER (WHERE ${SQL_OWN_TRANSFER_DEBIT}), 0), 2)::text`,
				'ownTransfers',
			)
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_UNKNOWN_DIRECTION})::int`, 'unknownDirection')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_MISSING_BASE_AMOUNT})::int`, 'missingBaseAmount')
			.getRawOne<{ownTransfers: string; unknownDirection: number; missingBaseAmount: number}>();
		return counts!;
	}

	private async findFirstBookingDate(accountId: string): Promise<string | null> {
		const row = await this.createOwnerScopedQuery(accountId)
			.select(`to_char(MIN("transaction"."bookingDate"), 'YYYY-MM-DD')`, 'first')
			.getRawOne<{first: string | null}>();
		return row?.first ?? null;
	}

	private createOwnerScopedQuery(accountId: string) {
		return this.bankTransactionRepository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.where('connection.accountId = :accountId', {accountId});
	}
}

/** Period starts from `from` through `to`, or null when the range is backwards, ends after `asOf` or is too long. */
/** The sum of the balances, or null when any of them could not be converted. */
function sumBalances(rows: Array<{balance: string | null}>): string | null {
	let cents = 0n;
	for (const {balance} of rows) {
		if (balance === null) return null;
		cents += parseCents(balance);
	}
	return formatCents(cents);
}

function periodStarts(interval: CashFlowInterval, from: string, to: string, asOf: string): string[] | null {
	const starts: string[] = [];
	for (let start = periodStart(from, interval); start <= to; start = nextPeriodStart(start, interval)) {
		starts.push(start);
		if (starts.length > CASH_FLOW_MAX_PERIODS[interval]) break;
	}
	return from > to || to > asOf || starts.length > CASH_FLOW_MAX_PERIODS[interval] ? null : starts;
}

/** Calendar dates as `YYYY-MM-DD`, computed in UTC so no local offset shifts a day. */
function toDate(value: string): Date {
	return new Date(`${value}T00:00:00Z`);
}

function addDays(value: string, days: number): string {
	const date = toDate(value);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** The Monday, 1st or 1 January on or before `value`, like Postgres `date_trunc`. */
function periodStart(value: string, interval: CashFlowInterval): string {
	if (interval === 'year') return `${value.slice(0, 4)}-01-01`;
	if (interval === 'month') return `${value.slice(0, 7)}-01`;
	return addDays(value, -((toDate(value).getUTCDay() + 6) % 7));
}

function nextPeriodStart(start: string, interval: CashFlowInterval): string {
	if (interval === 'week') return addDays(start, 7);
	const date = toDate(start);
	if (interval === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
	else date.setUTCMonth(date.getUTCMonth() + 1);
	return date.toISOString().slice(0, 10);
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
