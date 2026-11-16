import {BadRequestException, Injectable} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {
	BANK_TRANSACTION_UNCATEGORIZED,
	type BankTransactionBreakdown,
	type BankTransactionBreakdownPart,
	type BankTransactionBreakdownPeriod,
	type BankTransactionCategory,
} from '@tempo/contracts';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BANKING_TRANSACTION_BREAKDOWN_RANGE} from '../api/constants/banking-messages.constants';
import type {BankTransactionBreakdownQueryDto} from '../api/dtos/bank-transaction-breakdown-query.dto';
import {BankTransaction} from '../bank-transaction.entity';
import {MerchantLogoService} from '../merchant-logos/merchant-logo.service';
import {type ReportingOwner, totalsCurrency} from '../reporting-currency';
import {formatCents, parseCents, periodStarts, periodWindows} from '../summary/bank-transaction-summary';
import {
	SQL_BASE_AMOUNT,
	SQL_INCOME_SOURCE,
	SQL_PERIOD_START,
	applyBankTransactionFilters,
	createOwnerScopedQuery,
	findFirstBookingDate,
} from './bank-transaction-filters';

const CATEGORY_KEY = `COALESCE("transaction"."category", '${BANK_TRANSACTION_UNCATEGORIZED}')`;

type PartRow = {start: string; key: string; amount: string};
type SourceRow = {key: string; label: string; latestId: string};

/** Where the owner's money went and came from over the years, on the summary's definitions. */
@Injectable()
export class BankTransactionHistoryService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		private readonly merchantLogoService: MerchantLogoService,
	) {}

	/**
	 * Spending by category or income by source per month or year. Each period's total equals cash flow's for it:
	 * spending is net of refunds (a refund-only `REFUND` part is negative), own transfers and currency exchanges are
	 * left out, and rows without a base-currency amount are not counted.
	 */
	async getBreakdown(
		owner: ReportingOwner,
		{interval, by, from, to, asOf}: BankTransactionBreakdownQueryDto,
	): Promise<BankTransactionBreakdown> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const starts = periodStarts(interval, from, to, asOf);
		if (!starts) throw new BadRequestException(BANKING_TRANSACTION_BREAKDOWN_RANGE);
		const flow = by === 'category' ? 'SPENDING' : 'INCOME';
		const key = by === 'category' ? CATEGORY_KEY : SQL_INCOME_SOURCE;
		const flowQuery = () => {
			const query = createOwnerScopedQuery(this.bankTransactionRepository, accountId);
			applyBankTransactionFilters(query, {
				bookingDate: {from: starts[0], to},
				baseAmount: 'PRESENT',
				cashFlows: [flow],
			});
			return query.setParameter('interval', interval);
		};

		const [firstBookingDate, parts, sources] = await Promise.all([
			findFirstBookingDate(this.bankTransactionRepository, accountId),
			flowQuery()
				.select(SQL_PERIOD_START, 'start')
				.addSelect(key, 'key')
				.addSelect(`ROUND(SUM(${SQL_BASE_AMOUNT}), 2)::text`, 'amount')
				.groupBy('1')
				.addGroupBy('2')
				.getRawMany<PartRow>(),
			by === 'source'
				? flowQuery()
						.select(key, 'key')
						.addSelect(`mode() WITHIN GROUP (ORDER BY "transaction"."displayDescription")`, 'label')
						.addSelect(
							`(array_agg("transaction"."id" ORDER BY "transaction"."bookingDate" DESC, "transaction"."id" DESC))[1]`,
							'latestId',
						)
						.groupBy('1')
						.getRawMany<SourceRow>()
				: Promise.resolve([]),
		]);
		const looks = await this.sourceLooks(accountId, sources);
		// Spending sums are negative in the ledger; the breakdown reports them as positive amounts.
		const sign = by === 'category' ? -1n : 1n;
		// Base amounts have two decimals, so a period's total is exactly the sum of its parts.
		const totalByStart = new Map<string, bigint>();
		const partsByStart = new Map<string, PartRow[]>();
		for (const row of parts) {
			partsByStart.set(row.start, [...(partsByStart.get(row.start) ?? []), row]);
			totalByStart.set(row.start, (totalByStart.get(row.start) ?? 0n) + sign * parseCents(row.amount));
		}
		const labelByKey = new Map(sources.map((row) => [row.key, row.label]));

		const periods = periodWindows(interval, starts, to, asOf, firstBookingDate).map(
			(window): BankTransactionBreakdownPeriod => {
				const periodParts = (partsByStart.get(window.start) ?? [])
					.map((row) => ({key: row.key, cents: sign * parseCents(row.amount)}))
					.filter((part) => part.cents !== 0n)
					.sort((left, right) =>
						left.cents !== right.cents
							? left.cents > right.cents
								? -1
								: 1
							: left.key < right.key
								? -1
								: 1,
					);
				return {
					...window,
					total: formatCents(totalByStart.get(window.start) ?? 0n),
					parts: periodParts.map((part) => ({
						key: part.key,
						label: labelByKey.get(part.key) ?? part.key,
						amount: formatCents(part.cents),
						...looks.get(part.key),
					})),
				};
			},
		);
		return {baseCurrency, interval, by, periods};
	}

	/** Each source looks like its latest income: that merchant's logo when it has a trusted one, else its category. */
	private async sourceLooks(
		accountId: Account['id'],
		sources: readonly SourceRow[],
	): Promise<Map<string, Pick<BankTransactionBreakdownPart, 'merchantLogoUrl' | 'category'>>> {
		const looks = new Map<string, Pick<BankTransactionBreakdownPart, 'merchantLogoUrl' | 'category'>>();
		if (sources.length === 0) return looks;
		const rows = await createOwnerScopedQuery(this.bankTransactionRepository, accountId)
			.select([
				'transaction.id',
				'transaction.merchantKey',
				'transaction.ownTransferEvidence',
				'transaction.category',
			])
			.addSelect('transaction.financialEventType')
			.andWhere('transaction.id = ANY(:ids)', {ids: sources.map((source) => source.latestId)})
			.getMany();
		const logos = await this.merchantLogoService.getLogoUrls(accountId, rows);
		const byId = new Map(rows.map((row) => [row.id, row]));
		for (const {key, latestId} of sources)
			looks.set(key, {
				merchantLogoUrl: logos.get(latestId) ?? null,
				category: (byId.get(latestId)?.category as BankTransactionCategory | null | undefined) ?? null,
			});
		return looks;
	}
}
