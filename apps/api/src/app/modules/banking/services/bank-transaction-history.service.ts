import {BadRequestException, Injectable} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {
	BANK_TRANSACTION_UNCATEGORIZED,
	type BankTransactionBreakdown,
	type BankTransactionBreakdownPeriod,
	type BankTransactionEvent,
	type BankTransactionEvents,
} from '@tempo/contracts';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_TRANSACTION_BREAKDOWN_RANGE,
	BANKING_TRANSACTION_EVENTS_RANGE,
} from '../api/constants/banking-messages.constants';
import type {
	BankTransactionBreakdownQueryDto,
	BankTransactionEventsQueryDto,
} from '../api/dtos/bank-transaction-breakdown-query.dto';
import {BankTransaction} from '../bank-transaction.entity';
import {addDays} from '../banking.utils';
import {formatCents, nextPeriodStart, parseCents, periodStarts} from '../summary/bank-transaction-summary';
import {
	SQL_INCOME,
	SQL_SPENDING,
	applyBankTransactionFilters,
	createOwnerScopedQuery,
	findFirstBookingDate,
} from './bank-transaction-filters';

const BASE_AMOUNT = '"transaction"."amountInBaseCurrency"';
const CATEGORY_KEY = `COALESCE("transaction"."category", '${BANK_TRANSACTION_UNCATEGORIZED}')`;
const SOURCE_KEY = `COALESCE(NULLIF("transaction"."merchantKey", ''), "transaction"."displayDescription")`;

/** A single payment is an event from this share of a usual month's spending. */
const EVENT_SHARE_OF_USUAL_MONTH = 0.5;
/** The usual month averages this many calendar months before it, every one inside the owner's history. */
const USUAL_MONTHS = 12;
/** A payment is regular with this many other payments of the same merchant and direction nearby... */
const REGULAR_OTHER_PAYMENTS = 2;
/** ...booked within this many months either side... */
const REGULAR_WINDOW_MONTHS = 3;
/** ...each within this share of its amount. */
const REGULAR_AMOUNT_TOLERANCE = 0.25;

type PartRow = {start: string; key: string; amount: string};
type EventRow = Omit<BankTransactionEvent, 'share'> & {share: string};

/** Where the owner's money went and came from over the years, on the summary's definitions. */
@Injectable()
export class BankTransactionHistoryService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
	) {}

	/**
	 * Spending by category or income by source per month or year. Each period's total equals cash flow's for it:
	 * spending is net of refunds (a refund-only `REFUND` part is negative), own transfers and currency exchanges are
	 * left out, and rows without a base-currency amount are not counted.
	 */
	async getBreakdown(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		{interval, by, from, to, asOf}: BankTransactionBreakdownQueryDto,
	): Promise<BankTransactionBreakdown> {
		const starts = periodStarts(interval, from, to, asOf);
		if (!starts) throw new BadRequestException(BANKING_TRANSACTION_BREAKDOWN_RANGE);
		const flow = by === 'category' ? 'SPENDING' : 'INCOME';
		const key = by === 'category' ? CATEGORY_KEY : SOURCE_KEY;
		const period = `to_char(date_trunc(:interval, "transaction"."bookingDate"::timestamp), 'YYYY-MM-DD')`;
		const flowQuery = () => {
			const query = createOwnerScopedQuery(this.bankTransactionRepository, accountId);
			applyBankTransactionFilters(query, {
				bookingDate: {from: starts[0], to},
				baseAmount: 'PRESENT',
				cashFlows: [flow],
			});
			return query.setParameter('interval', interval);
		};

		const [firstBookingDate, totals, parts, labels] = await Promise.all([
			findFirstBookingDate(this.bankTransactionRepository, accountId),
			flowQuery()
				.select(period, 'start')
				.addSelect(`ROUND(SUM(${BASE_AMOUNT}), 2)::text`, 'amount')
				.groupBy('1')
				.getRawMany<{start: string; amount: string}>(),
			flowQuery()
				.select(period, 'start')
				.addSelect(key, 'key')
				.addSelect(`ROUND(SUM(${BASE_AMOUNT}), 2)::text`, 'amount')
				.groupBy('1')
				.addGroupBy('2')
				.getRawMany<PartRow>(),
			by === 'source'
				? flowQuery()
						.select(key, 'key')
						.addSelect(`mode() WITHIN GROUP (ORDER BY "transaction"."displayDescription")`, 'label')
						.groupBy('1')
						.getRawMany<{key: string; label: string}>()
				: Promise.resolve([]),
		]);
		// Spending sums are negative in the ledger; the breakdown reports them as positive amounts.
		const sign = by === 'category' ? -1n : 1n;
		const totalByStart = new Map(totals.map((row) => [row.start, sign * parseCents(row.amount)]));
		const partsByStart = new Map<string, PartRow[]>();
		for (const row of parts) partsByStart.set(row.start, [...(partsByStart.get(row.start) ?? []), row]);
		const labelByKey = new Map(labels.map((row) => [row.key, row.label]));

		const periods: BankTransactionBreakdownPeriod[] = [];
		for (const start of starts) {
			const periodEnd = addDays(nextPeriodStart(start, interval), -1);
			if (!firstBookingDate || periodEnd < firstBookingDate) continue;
			const periodParts = (partsByStart.get(start) ?? [])
				.map((row) => ({key: row.key, cents: sign * parseCents(row.amount)}))
				.filter((part) => part.cents !== 0n)
				.sort((left, right) =>
					left.cents !== right.cents ? (left.cents > right.cents ? -1 : 1) : left.key < right.key ? -1 : 1,
				);
			periods.push({
				start,
				end: periodEnd < to ? periodEnd : to,
				// As in cash flow: a period that ends today is still running; one cut by where history starts is partial.
				complete: periodEnd < asOf && periodEnd <= to && start >= firstBookingDate,
				total: formatCents(totalByStart.get(start) ?? 0n),
				parts: periodParts.map((part) => ({
					key: part.key,
					label: labelByKey.get(part.key) ?? part.key,
					amount: formatCents(part.cents),
				})),
			});
		}
		return {baseCurrency, interval, by, periods};
	}

	/**
	 * One-off payments: a spending or income transaction (never a refund) of at least half a usual month's spending
	 * that is not regular. The usual month is the mean spending, net of refunds, of the 12 calendar months before the
	 * payment's month; every one of them must lie inside the owner's history (from the month of the first booking),
	 * or the month has no events. Regular means the same merchant key in the same direction has at least two other
	 * payments within three months either side, each within 25% of this one's amount. The running month (`asOf`'s)
	 * has none, and an event can stop being one once later payments make it regular.
	 */
	async getEvents(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		{from, to, asOf}: BankTransactionEventsQueryDto,
	): Promise<BankTransactionEvents> {
		if (from > to || to > asOf) throw new BadRequestException(BANKING_TRANSACTION_EVENTS_RANGE);
		const rows: EventRow[] = await this.bankTransactionRepository.manager.query(
			`
			WITH owned AS (
				SELECT t.* FROM "bank_transactions" t
				JOIN "bank_accounts" a ON a."id" = t."bankAccountId"
				JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
				WHERE c."accountId" = $1 AND t."bookingDate" <= $4::date
			), counted AS (
				SELECT "transaction"."id", "transaction"."bookingDate" AS "day",
					date_trunc('month', "transaction"."bookingDate")::date AS "month",
					"transaction"."merchantKey", "transaction"."category", "transaction"."displayDescription" AS "name",
					"transaction"."amountInBaseCurrency" AS "base",
					CASE
						WHEN ${SQL_INCOME} THEN 'INCOME'
						WHEN "transaction"."creditDebitIndicator" = 'DBIT' THEN 'EXPENSE'
						ELSE 'REFUND'
					END AS "direction"
				FROM owned "transaction"
				WHERE "transaction"."amountInBaseCurrency" IS NOT NULL AND (${SQL_SPENDING} OR ${SQL_INCOME})
			), spending AS (
				SELECT "month", -SUM("base") FILTER (WHERE "direction" <> 'INCOME') AS "spent" FROM counted GROUP BY "month"
			), usual AS (
				SELECT m."month", (
					SELECT COALESCE(SUM(s."spent"), 0) / $5::int FROM spending s
					WHERE s."month" >= m."month" - make_interval(months => $5::int) AND s."month" < m."month"
				) AS "usual"
				FROM (SELECT DISTINCT "month" FROM counted) m
				WHERE m."month" >= (SELECT date_trunc('month', MIN("bookingDate")) FROM owned) + make_interval(months => $5::int)
					AND m."month" < date_trunc('month', $4::date)
			), large AS MATERIALIZED (
				SELECT c.*, u."usual" FROM counted c JOIN usual u ON u."month" = c."month"
				WHERE c."direction" <> 'REFUND' AND c."day" BETWEEN $2::date AND $3::date
					AND u."usual" > 0 AND ABS(c."base") >= $6::numeric * u."usual"
			)
			SELECT l."id", to_char(l."day", 'YYYY-MM-DD') AS "date", l."name", l."category", l."direction",
				ROUND(ABS(l."base"), 2)::text AS "amount", ROUND(l."usual", 2)::text AS "usualMonth",
				ROUND(ABS(l."base") / l."usual", 2)::text AS "share"
			FROM large l
			-- Regular means repeating with the same merchant; a payment without a merchant key has none, so it never is.
			WHERE (
				SELECT COUNT(*) FROM counted p
				WHERE p."merchantKey" = l."merchantKey" AND p."direction" = l."direction" AND p."id" <> l."id"
					AND p."day" BETWEEN l."day" - make_interval(months => $7::int) AND l."day" + make_interval(months => $7::int)
					AND ABS(p."base") BETWEEN ABS(l."base") * (1 - $8::numeric) AND ABS(l."base") * (1 + $8::numeric)
			) < $9::int
			ORDER BY l."day", l."id"`,
			[
				accountId,
				from,
				to,
				asOf,
				USUAL_MONTHS,
				EVENT_SHARE_OF_USUAL_MONTH,
				REGULAR_WINDOW_MONTHS,
				REGULAR_AMOUNT_TOLERANCE,
				REGULAR_OTHER_PAYMENTS,
			],
		);
		return {baseCurrency, events: rows.map((row) => ({...row, share: Number(row.share)}))};
	}
}
