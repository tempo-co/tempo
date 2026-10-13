import {BadRequestException, Injectable} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_TRANSACTION_CASH_FLOW_RANGE,
	BANKING_TRANSACTION_SUMMARY_FUTURE_MONTH,
} from '../api/constants/banking-messages.constants';
import type {BankTransactionCashFlowQueryDto} from '../api/dtos/bank-transaction-cash-flow-query.dto';
import type {BankTransactionSummaryQueryDto} from '../api/dtos/bank-transaction-summary-query.dto';
import type {
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
import {
	SQL_CATEGORIZATION_FAILED,
	SQL_CATEGORIZING,
	SQL_MISSING_BASE_AMOUNT,
	SQL_OWN_TRANSFER_DEBIT,
	SQL_SPENDING,
	SQL_UNKNOWN_DIRECTION,
	applyBankTransactionFilters,
} from './bank-transaction-filters';

const BASELINE_MONTHS = 3;
const CASH_FLOW_MAX_MONTHS = 36;
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
		{from, to, asOf}: BankTransactionCashFlowQueryDto,
	): Promise<BankTransactionCashFlowResponseDto> {
		const span = monthIndex(to) - monthIndex(from) + 1;
		if (span < 1 || span > CASH_FLOW_MAX_MONTHS || to > asOf.slice(0, 7)) {
			throw new BadRequestException(BANKING_TRANSACTION_CASH_FLOW_RANGE);
		}
		const toEnd = `${to}-${daysInMonth(to)}`;
		const through = asOf < toEnd ? asOf : toEnd;

		const [firstBookingDate, rows] = await Promise.all([
			this.findFirstBookingDate(accountId),
			this.findMonthlyFlows(accountId, `${from}-01`, through),
		]);
		const totals = new Map(rows.map((row) => [row.month, row]));
		const firstMonth = firstBookingDate?.slice(0, 7);
		const months: BankTransactionCashFlowResponseDto['months'] = [];
		for (let index = monthIndex(from); index <= monthIndex(to); index++) {
			const month = monthFromIndex(index);
			if (!firstMonth || month < firstMonth) continue;
			const spending = -parseCents(totals.get(month)?.spending ?? '0');
			const income = parseCents(totals.get(month)?.income ?? '0');
			months.push({
				month,
				spending: formatCents(spending),
				income: formatCents(income),
				net: formatCents(income - spending),
			});
		}
		return {baseCurrency, through, months};
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

	/** Raw signed spending and income sums per month, on the same filters as {@link findFlows}. */
	private findMonthlyFlows(accountId: string, from: string, to: string) {
		const query = this.createOwnerScopedQuery(accountId);
		applyBankTransactionFilters(query, {
			bookingDate: {from, to},
			baseAmount: 'PRESENT',
			cashFlows: ['SPENDING', 'INCOME'],
		});
		return query
			.select(`to_char("transaction"."bookingDate", 'YYYY-MM')`, 'month')
			.addSelect(`ROUND(COALESCE(SUM(${BASE_AMOUNT}) FILTER (WHERE ${SQL_SPENDING}), 0), 2)::text`, 'spending')
			.addSelect(`ROUND(COALESCE(SUM(${BASE_AMOUNT}) FILTER (WHERE NOT ${SQL_SPENDING}), 0), 2)::text`, 'income')
			.groupBy('1')
			.getRawMany<{month: string; spending: string; income: string}>();
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

function monthIndex(month: string): number {
	return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function monthFromIndex(index: number): string {
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
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
