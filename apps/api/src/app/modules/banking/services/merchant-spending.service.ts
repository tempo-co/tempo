import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {
	MERCHANT_LIST_DEFAULT_LIMIT,
	MERCHANT_RANKING_BASELINE_PERIODS,
	MERCHANT_RANKING_DEFAULT_LIMIT,
	type MerchantGroup,
	type MerchantGroupKind,
	type MerchantGroupListItem,
	type MerchantGroupPeriod,
	type MerchantGroupPeriods,
	type MerchantGroupPeriodsQuery,
	type MerchantGroupVariant,
	type MerchantGroupsQuery,
	type MerchantGroupsResponse,
	type MerchantRanking,
	type MerchantRankingItem,
	type MerchantRankingQuery,
} from '@tempo/contracts';
import {Repository} from 'typeorm';

import {
	MERCHANT_NOT_FOUND,
	MERCHANT_PERIODS_RANGE,
	MERCHANT_RANKING_FUTURE_PERIOD,
} from '../api/constants/banking-messages.constants';
import {BankTransaction} from '../bank-transaction.entity';
import {addDays} from '../banking.utils';
import {MerchantLogoService} from '../merchant-logos/merchant-logo.service';
import {MERCHANT_STATUSES} from '../merchant-logos/merchant.entity';
import {type ReportingOwner, totalsCurrency} from '../reporting-currency';
import {
	averageCents,
	divideRounded,
	formatCents,
	nextPeriodStart,
	periodStart,
	periodStarts,
	periodWindows,
} from '../summary/bank-transaction-summary';
import {
	SQL_BASE_AMOUNT,
	SQL_INCOME,
	SQL_INTERNAL,
	SQL_MERCHANT_GROUP,
	SQL_MERCHANT_KEY_NAME,
	SQL_MISSING_BASE_AMOUNT,
	SQL_PERIOD_START,
	SQL_SPENDING,
	SQL_UNKNOWN_DIRECTION,
	applyBankTransactionFilters,
	createOwnerScopedQuery,
	findFirstBookingDate,
} from './bank-transaction-filters';

/** Each amount rounded to minor units before summing; monetary SQL results are never converted to Number. */
const CENTS = `ROUND(${SQL_BASE_AMOUNT} * 100)`;
const DEBIT = `"transaction"."creditDebitIndicator" = 'DBIT'`;
const CREDIT = `"transaction"."creditDebitIndicator" = 'CRDT'`;

type VariantRow = {
	groupId: string | null;
	key: string;
	name: string;
	paid: string;
	refunded: string;
	received: string;
	count: number;
	paymentCount: number;
	unknownDirection: number;
	missingBaseAmount: number;
	firstDate: string | null;
	lastDate: string | null;
};

type Group = Omit<MerchantGroup, 'baseCurrency'> & {spentCents: bigint};

/**
 * Money paid to and received from one merchant group: every merchant key identified with one brand, or a single
 * merchant key such as a person. Rows count on the summary's definitions (`SQL_SPENDING`, `SQL_INCOME`), so a group's
 * totals reconcile with the transaction list filtered by `merchantGroup`.
 */
@Injectable()
export class MerchantSpendingService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		private readonly merchantLogoService: MerchantLogoService,
	) {}

	async list(
		owner: ReportingOwner,
		{search, offset = 0, limit = MERCHANT_LIST_DEFAULT_LIMIT}: MerchantGroupsQuery,
	): Promise<MerchantGroupsResponse> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const needle = search?.trim().toLocaleLowerCase();
		const groups = (await this.findGroups(accountId))
			.filter(
				(group) =>
					!needle ||
					[group.name, ...group.variants.flatMap(({key, name}) => [key, name])].some((text) =>
						text.toLocaleLowerCase().includes(needle),
					),
			)
			.sort(compareSpent);
		const page = await this.withLogos(accountId, groups.slice(offset, offset + limit));
		return {baseCurrency, merchants: page.map(toListItem), total: groups.length};
	}

	async get(owner: ReportingOwner, groupId: string): Promise<MerchantGroup> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const [group] = await this.withLogos(accountId, await this.findGroups(accountId, [groupId]));
		if (!group) throw new NotFoundException(MERCHANT_NOT_FOUND);
		const {spentCents: _spentCents, ...response} = group;
		return {...response, baseCurrency};
	}

	async getPeriods(
		owner: ReportingOwner,
		groupId: string,
		{interval, from, to, asOf}: MerchantGroupPeriodsQuery,
	): Promise<MerchantGroupPeriods> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const starts = periodStarts(interval, from, to, asOf);
		if (!starts) throw new BadRequestException(MERCHANT_PERIODS_RANGE);
		const [exists, firstBookingDate] = await Promise.all([
			this.groupExists(accountId, groupId),
			findFirstBookingDate(this.bankTransactionRepository, accountId),
		]);
		if (!exists) throw new NotFoundException(MERCHANT_NOT_FOUND);

		const query = createOwnerScopedQuery(this.bankTransactionRepository, accountId);
		applyBankTransactionFilters(query, {bookingDate: {from: starts[0], to}, merchantGroup: groupId});
		const rows = await query
			.select(SQL_PERIOD_START, 'start')
			.addSelect(`COALESCE(SUM(-${CENTS}) FILTER (WHERE ${SQL_SPENDING}), 0)::text`, 'spent')
			.addSelect(`COALESCE(SUM(${CENTS}) FILTER (WHERE ${SQL_INCOME}), 0)::text`, 'received')
			.addSelect('COUNT(*)::int', 'count')
			.setParameter('interval', interval)
			.groupBy('1')
			.getRawMany<{start: string; spent: string; received: string; count: number}>();
		const totals = new Map(rows.map((row) => [row.start, row]));

		const periods = periodWindows(interval, starts, to, asOf, firstBookingDate).map(
			(window): MerchantGroupPeriod => {
				const row = totals.get(window.start);
				return {
					...window,
					spent: formatCents(BigInt(row?.spent ?? '0')),
					received: formatCents(BigInt(row?.received ?? '0')),
					count: row?.count ?? 0,
				};
			},
		);
		return {baseCurrency, interval, periods};
	}

	/**
	 * Groups with net spending in the period containing `period`, most spent first, each against its average over the
	 * earlier periods. While the period runs, the earlier ones count through the same day of their period, like the
	 * summary's category baselines.
	 */
	async getRanking(
		owner: ReportingOwner,
		{interval, period, asOf, limit = MERCHANT_RANKING_DEFAULT_LIMIT}: MerchantRankingQuery,
	): Promise<MerchantRanking> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const start = periodStart(period, interval);
		if (start > asOf) throw new BadRequestException(MERCHANT_RANKING_FUTURE_PERIOD);
		const end = addDays(nextPeriodStart(start, interval), -1);
		const running = end >= asOf;
		const through = running ? asOf : end;
		const elapsedDays = daysBetween(start, through);

		const firstBookingDate = await findFirstBookingDate(this.bankTransactionRepository, accountId);
		const baseline: Array<{start: string; through: string}> = [];
		for (let earlier = start, index = 0; index < MERCHANT_RANKING_BASELINE_PERIODS; index++) {
			earlier = periodStart(addDays(earlier, -1), interval);
			const earlierEnd = addDays(nextPeriodStart(earlier, interval), -1);
			if (!firstBookingDate || earlierEnd < firstBookingDate) break;
			const cut = addDays(earlier, elapsedDays);
			baseline.unshift({start: earlier, through: running && cut < earlierEnd ? cut : earlierEnd});
		}

		const query = createOwnerScopedQuery(this.bankTransactionRepository, accountId);
		applyBankTransactionFilters(query, {
			bookingDate: {from: baseline[0]?.start ?? start, to: through},
			baseAmount: 'PRESENT',
			cashFlows: ['SPENDING'],
		});
		const rows = await query
			.select(SQL_MERCHANT_GROUP, 'groupId')
			.addSelect(`to_char("transaction"."bookingDate", 'YYYY-MM-DD')`, 'day')
			.addSelect(`SUM(-${CENTS})::text`, 'spent')
			.andWhere('"transaction"."merchantKey" IS NOT NULL')
			.groupBy('1')
			.addGroupBy('2')
			.getRawMany<{groupId: string | null; day: string; spent: string}>();

		const current = new Map<string, bigint>();
		const earlier = new Map<string, bigint[]>();
		for (const row of rows) {
			if (!row.groupId) continue;
			const cents = BigInt(row.spent);
			if (row.day >= start) {
				current.set(row.groupId, (current.get(row.groupId) ?? 0n) + cents);
				continue;
			}
			const index = baseline.findIndex((window) => row.day >= window.start && row.day <= window.through);
			if (index < 0) continue;
			const totals = earlier.get(row.groupId) ?? baseline.map(() => 0n);
			totals[index] += cents;
			earlier.set(row.groupId, totals);
		}

		const ranked = [...current.entries()]
			.filter(([, cents]) => cents > 0n)
			.sort(([leftId, left], [rightId, right]) =>
				left !== right ? (left > right ? -1 : 1) : leftId < rightId ? -1 : 1,
			);
		const shown = ranked.slice(0, limit);
		const [groups, counts] = await Promise.all([
			this.findGroups(
				accountId,
				shown.map(([groupId]) => groupId),
			).then((found) => this.withLogos(accountId, found)),
			this.countRows(
				accountId,
				shown.map(([groupId]) => groupId),
				start,
				through,
			),
		]);
		const byId = new Map(groups.map((group) => [group.id, group]));
		const merchants = shown.flatMap(([groupId, spent]): MerchantRankingItem[] => {
			const group = byId.get(groupId);
			if (!group) return [];
			const usual = baseline.length > 0 ? averageCents(earlier.get(groupId) ?? baseline.map(() => 0n)) : null;
			return [
				{
					id: groupId,
					name: group.name,
					kind: group.kind,
					logoUrl: group.logoUrl,
					spent: formatCents(spent),
					count: counts.get(groupId) ?? 0,
					usual: usual === null ? null : formatCents(usual),
					change: usual === null ? null : formatCents(spent - usual),
				},
			];
		});

		return {
			baseCurrency,
			interval,
			start,
			end,
			through,
			baselinePeriods: baseline.map((window) => window.start),
			merchants,
			total: ranked.length,
		};
	}

	/**
	 * All-time totals per group, optionally only the given groups; groups without rows are absent. Rows are totalled per
	 * merchant key first and the few keys are then mapped to their groups, so the brand lookup runs once per key rather
	 * than once per row. Logos are left out: `withLogos` adds them for the groups a response shows.
	 */
	private async findGroups(accountId: string, groupIds?: readonly string[]): Promise<Group[]> {
		if (groupIds?.length === 0) return [];
		// Byte order groups exactly like the database's deterministic collation and sorts the history much faster.
		const variants = createOwnerScopedQuery(this.bankTransactionRepository, accountId)
			.select(`${SQL_MERCHANT_KEY_NAME} COLLATE "C"`, 'key')
			.addSelect(
				`(array_agg("transaction"."displayDescription" ORDER BY "transaction"."bookingDate" DESC NULLS FIRST, "transaction"."createdAt" DESC))[1]`,
				'name',
			)
			.addSelect(`COALESCE(SUM(-${CENTS}) FILTER (WHERE ${SQL_SPENDING} AND ${DEBIT}), 0)::text`, 'paid')
			.addSelect(`COALESCE(SUM(${CENTS}) FILTER (WHERE ${SQL_SPENDING} AND ${CREDIT}), 0)::text`, 'refunded')
			.addSelect(`COALESCE(SUM(${CENTS}) FILTER (WHERE ${SQL_INCOME}), 0)::text`, 'received')
			.addSelect('COUNT(*)::int', 'count')
			.addSelect(
				`COUNT(*) FILTER (WHERE ${SQL_SPENDING} AND ${DEBIT} AND ${SQL_BASE_AMOUNT} IS NOT NULL)::int`,
				'paymentCount',
			)
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_UNKNOWN_DIRECTION})::int`, 'unknownDirection')
			.addSelect(`COUNT(*) FILTER (WHERE ${SQL_MISSING_BASE_AMOUNT})::int`, 'missingBaseAmount')
			.addSelect(`to_char(MIN("transaction"."bookingDate"), 'YYYY-MM-DD')`, 'firstDate')
			.addSelect(`to_char(MAX("transaction"."bookingDate"), 'YYYY-MM-DD')`, 'lastDate')
			.andWhere(`"transaction"."merchantKey" IS NOT NULL AND NOT ${SQL_INTERNAL}`)
			.groupBy('1');
		const [variantSql, parameters] = variants.getQueryAndParameters();
		// The same group as SQL_MERCHANT_GROUP gives each of the key's rows; the default collation keeps the key index.
		const groupId = `CASE WHEN variant."key" = '' THEN NULL ELSE COALESCE((SELECT 'b_' || md5(lower(btrim(merchant."brand"))) FROM "merchants" merchant WHERE merchant."accountId" = $${parameters.length + 1} AND merchant."key" = variant."key" COLLATE "default" AND merchant."status" = '${MERCHANT_STATUSES.IDENTIFIED}' AND btrim(merchant."brand") <> ''), 'k_' || md5(variant."key")) END`;
		const filter = groupIds ? `WHERE grouped."groupId" = ANY($${parameters.length + 2}::text[])` : '';
		const [rows, brandNames]: [VariantRow[], Map<string, string>] = await Promise.all([
			this.bankTransactionRepository.manager.query(
				`SELECT grouped.* FROM (SELECT ${groupId} AS "groupId", variant.* FROM (${variantSql}) variant) grouped ${filter}`,
				[...parameters, accountId, ...(groupIds ? [groupIds] : [])],
			),
			this.findBrandNames(accountId),
		]);

		const variantsByGroup = new Map<string, VariantRow[]>();
		for (const row of rows) {
			if (!row.groupId) continue;
			const variants = variantsByGroup.get(row.groupId) ?? [];
			variants.push(row);
			variantsByGroup.set(row.groupId, variants);
		}
		return [...variantsByGroup.entries()].map(([id, rows]) => toGroup(id, rows, brandNames.get(id)));
	}

	/** The groups with each one's logo; only the groups a response shows are looked up. */
	private async withLogos(accountId: string, groups: Group[]): Promise<Group[]> {
		if (groups.length === 0) return groups;
		const logos = await this.merchantLogoService.getLogoUrls(
			accountId,
			groups.map((group) => ({
				id: group.id,
				// Any of the group's keys finds its brand's logo; the direction is dropped before the lookup.
				merchantKey: `EXPENSE:${group.variants[0].key}`,
				ownTransferEvidence: null,
				financialEventType: null,
			})),
		);
		for (const group of groups) group.logoUrl = logos.get(group.id) ?? null;
		return groups;
	}

	/** Each brand's most common spelling among the owner's identified merchants, by group id. */
	private async findBrandNames(accountId: string): Promise<Map<string, string>> {
		const rows: Array<{id: string; name: string}> = await this.bankTransactionRepository.manager.query(
			`SELECT 'b_' || md5(lower(btrim("brand"))) AS "id", mode() WITHIN GROUP (ORDER BY btrim("brand")) AS "name"
			FROM "merchants"
			WHERE "accountId" = $1 AND "status" = $2 AND btrim("brand") <> ''
			GROUP BY 1`,
			[accountId, MERCHANT_STATUSES.IDENTIFIED],
		);
		return new Map(rows.map((row) => [row.id, row.name]));
	}

	private async countRows(accountId: string, groupIds: string[], from: string, to: string) {
		if (groupIds.length === 0) return new Map<string, number>();
		const rows = await createOwnerScopedQuery(this.bankTransactionRepository, accountId)
			.select(SQL_MERCHANT_GROUP, 'groupId')
			.addSelect('COUNT(*)::int', 'count')
			.andWhere('"transaction"."bookingDate" BETWEEN :from AND :to', {from, to})
			.andWhere(`${SQL_MERCHANT_GROUP} IN (:...groupIds)`, {groupIds})
			.groupBy('1')
			.getRawMany<{groupId: string; count: number}>();
		return new Map(rows.map((row) => [row.groupId, row.count]));
	}

	private async groupExists(accountId: string, groupId: string): Promise<boolean> {
		const row = await createOwnerScopedQuery(this.bankTransactionRepository, accountId)
			.select('1', 'found')
			.andWhere(`${SQL_MERCHANT_GROUP} = :groupId`, {groupId})
			.limit(1)
			.getRawOne();
		return Boolean(row);
	}
}

function toGroup(id: string, rows: VariantRow[], brandName: string | undefined): Group {
	const sum = (pick: (row: VariantRow) => bigint) => rows.reduce((total, row) => total + pick(row), 0n);
	const count = (pick: (row: VariantRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
	const variants = rows
		.map((row): MerchantGroupVariant & {spentCents: bigint} => ({
			key: row.key,
			name: row.name,
			spentCents: BigInt(row.paid) - BigInt(row.refunded),
			spent: formatCents(BigInt(row.paid) - BigInt(row.refunded)),
			received: formatCents(BigInt(row.received)),
			count: row.count,
			lastDate: row.lastDate,
		}))
		.sort((left, right) =>
			left.spentCents !== right.spentCents
				? left.spentCents > right.spentCents
					? -1
					: 1
				: (right.lastDate ?? '').localeCompare(left.lastDate ?? ''),
		);
	const paid = sum((row) => BigInt(row.paid));
	const refunded = sum((row) => BigInt(row.refunded));
	const paymentCount = count((row) => row.paymentCount);
	const dates = (pick: (row: VariantRow) => string | null) =>
		rows
			.map(pick)
			.filter((date): date is string => date !== null)
			.sort();
	const firstDates = dates((row) => row.firstDate);
	const lastDates = dates((row) => row.lastDate);
	const kind: MerchantGroupKind = id.startsWith('b_') ? 'BRAND' : 'MERCHANT';
	// The latest-used key names a group without a brand; a brand group is named by its brand.
	const latest = [...variants].sort((left, right) => (right.lastDate ?? '').localeCompare(left.lastDate ?? ''))[0];
	return {
		id,
		name: (kind === 'BRAND' && brandName) || latest.name,
		kind,
		logoUrl: null,
		spentCents: paid - refunded,
		spent: formatCents(paid - refunded),
		received: formatCents(sum((row) => BigInt(row.received))),
		count: count((row) => row.count),
		lastDate: lastDates.at(-1) ?? null,
		paid: formatCents(paid),
		refunded: formatCents(refunded),
		paymentCount,
		averagePayment: paymentCount > 0 ? formatCents(divideRounded(paid, BigInt(paymentCount))) : null,
		firstDate: firstDates[0] ?? null,
		excluded: {
			unknownDirection: count((row) => row.unknownDirection),
			missingBaseAmount: count((row) => row.missingBaseAmount),
		},
		variants: variants.map(({spentCents: _spentCents, ...variant}) => variant),
	};
}

function toListItem(group: Group): MerchantGroupListItem {
	const {id, name, kind, logoUrl, spent, received, count, lastDate} = group;
	return {id, name, kind, logoUrl, spent, received, count, lastDate};
}

/** Most spent first, then by name. */
function compareSpent(left: Group, right: Group): number {
	if (left.spentCents !== right.spentCents) return left.spentCents > right.spentCents ? -1 : 1;
	return left.name.localeCompare(right.name);
}

function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
