import {Injectable} from '@nestjs/common';
import {DATA_COVERAGE_DAYS, type DataCoverage, type DataCoverageSource, type DateRange} from '@tempo/contracts';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {addDays} from '../banking.utils';
import {BANK_CONNECTION_PROVIDERS, UNFINISHED_AUTHORIZATION_STATUSES} from './banking-sync.constants';
import {ImportedRowRecordsRegistry} from './imported-row-records';

export type CoverageOwner = Pick<Account, 'id'>;

type AccountCoverage = {bankAccountId: string; source: DataCoverageSource; ranges: DateRange[]};

/**
 * Which days an owner's data covers, per shown account (a hidden one counts in no total, so it covers nothing here). An
 * account covers from its first transaction (or the earlier day its sync recorded covering) through its last covered
 * day: the newer of the day its transactions were last fetched completely and the newest end date of its imports that
 * are not undone. Only gaps something recorded are left out: between two imported statements whose balances do not
 * follow on, and before a reconnect's sync coverage when an earlier sync left off sooner. No day after `asOf` counts.
 */
@Injectable()
export class DataCoverageService {
	constructor(
		private readonly dataSource: DataSource,
		private readonly importedRowRecords: ImportedRowRecordsRegistry,
	) {}

	async getCoverage(owner: CoverageOwner, asOf: string): Promise<DataCoverage> {
		const from = addDays(asOf, 1 - DATA_COVERAGE_DAYS);
		const accounts = (await this.findAccountCoverage(owner, asOf)).map(({bankAccountId, source, ranges}) => ({
			bankAccountId,
			source,
			coveredThrough: ranges.at(-1)?.to ?? null,
			ranges: ranges.flatMap((range) =>
				range.to < from ? [] : [{from: range.from < from ? from : range.from, to: range.to}],
			),
		}));
		return {from, to: asOf, lastCoveredDay: newest(accounts.map((account) => account.coveredThrough)), accounts};
	}

	/**
	 * The days some account's data covers, not after `asOf`, merged across accounts and oldest first; the last one ends
	 * on the last covered day.
	 */
	async findCoveredDays(owner: CoverageOwner, asOf: string): Promise<DateRange[]> {
		return mergeRanges(
			(await this.findAccountCoverage(owner, asOf)).flatMap(({ranges}) => ranges),
			asOf,
		);
	}

	/** Each shown account the connection list holds, in its order, with its covered days cut at `asOf`. */
	private async findAccountCoverage(owner: CoverageOwner, asOf: string): Promise<AccountCoverage[]> {
		const manager = this.dataSource.manager;
		const [accounts, imports] = await Promise.all([
			manager.query<
				Array<{
					id: string;
					provider: string;
					syncCoveredFrom: string | null;
					syncCoveredThrough: string | null;
					fetchedThrough: string | null;
					firstDate: string | null;
					lastSyncedBeforeCoverage: string | null;
				}>
			>(
				`SELECT bank_account."id", connection."provider",
					to_char(bank_account."syncCoveredFrom", 'YYYY-MM-DD') AS "syncCoveredFrom",
					to_char(bank_account."syncCoveredThrough", 'YYYY-MM-DD') AS "syncCoveredThrough",
					to_char(bank_account."transactionsFetchedThrough", 'YYYY-MM-DD') AS "fetchedThrough",
					(SELECT to_char(MIN(row."date"), 'YYYY-MM-DD') FROM "bank_transactions" row
						WHERE row."bankAccountId" = bank_account."id") AS "firstDate",
					(SELECT to_char(MAX(row."date"), 'YYYY-MM-DD') FROM "bank_transactions" row
						WHERE row."bankAccountId" = bank_account."id" AND row."importId" IS NULL
							AND row."date" < bank_account."syncCoveredFrom") AS "lastSyncedBeforeCoverage"
				FROM "bank_accounts" bank_account
				JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
				WHERE connection."accountId" = $1 AND connection."status" <> ALL($2::varchar[])
					AND NOT bank_account."isHidden"
				ORDER BY connection."createdAt" DESC, bank_account."createdAt" ASC`,
				[owner.id, UNFINISHED_AUTHORIZATION_STATUSES],
			),
			this.importedRowRecords.records.findImportCoverage(manager, owner.id),
		]);
		return accounts.map((account) => {
			const imported = imports.find(({bankAccountId}) => bankAccountId === account.id);
			const source: DataCoverageSource = account.provider === BANK_CONNECTION_PROVIDERS.FILE ? 'file' : 'sync';
			const through = newest([account.fetchedThrough, imported?.through ?? null]);
			if (!through) return {bankAccountId: account.id, source, ranges: []};
			const from = oldest([account.firstDate, account.syncCoveredFrom]) ?? through;
			const sync =
				account.syncCoveredFrom && account.syncCoveredThrough
					? {
							from: account.syncCoveredFrom,
							to: account.syncCoveredThrough < through ? account.syncCoveredThrough : through,
						}
					: null;
			const synced = (day: string) => !!sync && sync.from <= day && day <= sync.to;
			// A gap ends on the statements either side of it, and the days between are the missing ones; an end the
			// importer cut where sync coverage starts or stops is a missing day itself.
			const gaps = (imported?.gaps ?? []).map((gap) => ({
				from: synced(addDays(gap.from, -1)) ? gap.from : addDays(gap.from, 1),
				to: synced(addDays(gap.to, 1)) ? gap.to : addDays(gap.to, -1),
			}));
			if (account.lastSyncedBeforeCoverage && account.syncCoveredFrom)
				gaps.push({
					from: addDays(account.lastSyncedBeforeCoverage, 1),
					to: addDays(account.syncCoveredFrom, -1),
				});
			// Days sync has since fetched completely are in, whatever an earlier statement left out.
			const ranges = withoutGaps({from, to: through}, gaps, asOf);
			return {bankAccountId: account.id, source, ranges: mergeRanges(sync ? [...ranges, sync] : ranges, asOf)};
		});
	}
}

/** `span` cut at `asOf`, without the days of `gaps`, oldest first. */
function withoutGaps(span: DateRange, gaps: readonly DateRange[], asOf: string): DateRange[] {
	let ranges = mergeRanges([span], asOf);
	for (const gap of gaps) {
		if (gap.from > gap.to) continue;
		ranges = ranges.flatMap((range) => {
			if (gap.to < range.from || gap.from > range.to) return [range];
			const parts: DateRange[] = [];
			if (gap.from > range.from) parts.push({from: range.from, to: addDays(gap.from, -1)});
			if (gap.to < range.to) parts.push({from: addDays(gap.to, 1), to: range.to});
			return parts;
		});
	}
	return ranges;
}

/** The ranges cut at `asOf`, oldest first, with overlapping or touching ones joined. */
function mergeRanges(ranges: readonly DateRange[], asOf: string): DateRange[] {
	const merged: DateRange[] = [];
	for (const range of [...ranges].sort((a, b) => a.from.localeCompare(b.from))) {
		if (range.from > asOf) continue;
		const to = range.to < asOf ? range.to : asOf;
		const last = merged.at(-1);
		if (last && range.from <= addDays(last.to, 1)) {
			if (to > last.to) last.to = to;
		} else merged.push({from: range.from, to});
	}
	return merged;
}

function oldest(days: ReadonlyArray<string | null>): string | null {
	return days.reduce<string | null>((first, day) => (day && (!first || day < first) ? day : first), null);
}

function newest(days: ReadonlyArray<string | null>): string | null {
	return days.reduce<string | null>((latest, day) => (day && (!latest || day > latest) ? day : latest), null);
}
