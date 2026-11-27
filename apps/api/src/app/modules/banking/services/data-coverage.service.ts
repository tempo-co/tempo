import {Injectable} from '@nestjs/common';
import {DATA_COVERAGE_DAYS, type DataCoverage, type DataCoverageSource, type DateRange} from '@tempo/contracts';
import {DataSource} from 'typeorm';

import {dateInTimeZone} from '@core/time/app-time-zone';
import {Account} from '@modules/account/account.entity';

import {addDays} from '../banking.utils';
import {
	BANK_CONNECTION_PROVIDERS,
	BANK_SYNC_STATUSES,
	UNFINISHED_AUTHORIZATION_STATUSES,
} from './banking-sync.constants';
import {ImportedRowRecordsRegistry} from './imported-row-records';

export type CoverageOwner = Pick<Account, 'id' | 'timeZone'>;

type AccountCoverage = {bankAccountId: string; source: DataCoverageSource; ranges: DateRange[]};

/**
 * Which days an owner's data covers, per shown account (a hidden one counts in no total, so it covers nothing here). A
 * synced account covers its sync history, from its recorded sync coverage or its first synced (not imported)
 * transaction, whichever is earlier, through the day of its connection's last successful sync in the owner's time zone; any account covers the
 * date ranges of its imports that are not undone, and an account kept from a removed bank its synced rows' days. No day
 * after `asOf` counts.
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
			coveredThrough: coveredThrough(ranges),
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

	/** Each shown account the connection list holds, in its order, with its covered days merged and cut at `asOf`. */
	private async findAccountCoverage(owner: CoverageOwner, asOf: string): Promise<AccountCoverage[]> {
		const manager = this.dataSource.manager;
		const [accounts, imports] = await Promise.all([
			manager.query<
				Array<{
					id: string;
					provider: string;
					syncCoveredFrom: string | null;
					firstSyncedDate: string | null;
					lastSyncedDate: string | null;
					lastSuccessfulSyncAt: Date | null;
				}>
			>(
				`SELECT bank_account."id", connection."provider",
					to_char(bank_account."syncCoveredFrom", 'YYYY-MM-DD') AS "syncCoveredFrom",
					(SELECT to_char(MIN(row."date"), 'YYYY-MM-DD') FROM "bank_transactions" row
						WHERE row."bankAccountId" = bank_account."id" AND row."importId" IS NULL) AS "firstSyncedDate",
					(SELECT to_char(MAX(row."date"), 'YYYY-MM-DD') FROM "bank_transactions" row
						WHERE row."bankAccountId" = bank_account."id" AND row."importId" IS NULL) AS "lastSyncedDate",
					(SELECT MAX(run."finishedAt") FROM "bank_sync_runs" run
						WHERE run."bankConnectionId" = connection."id" AND run."status" = $2) AS "lastSuccessfulSyncAt"
				FROM "bank_accounts" bank_account
				JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
				WHERE connection."accountId" = $1 AND connection."status" <> ALL($3::varchar[])
					AND NOT bank_account."isHidden"
				ORDER BY connection."createdAt" DESC, bank_account."createdAt" ASC`,
				[owner.id, BANK_SYNC_STATUSES.SUCCEEDED, UNFINISHED_AUTHORIZATION_STATUSES],
			),
			this.importedRowRecords.records.findImportRanges(manager, owner.id),
		]);
		return accounts.map((account) => {
			const ranges: DateRange[] = imports
				.filter(({bankAccountId}) => bankAccountId === account.id)
				.map(({from, to}) => ({from, to}));
			const file = account.provider === BANK_CONNECTION_PROVIDERS.FILE;
			if (account.lastSuccessfulSyncAt) {
				const to = dateInTimeZone(account.lastSuccessfulSyncAt, owner.timeZone);
				ranges.push({from: oldest([account.syncCoveredFrom, account.firstSyncedDate]) ?? to, to});
			} else if (file && account.firstSyncedDate && account.lastSyncedDate)
				// An account kept from a removed bank keeps its synced history, without the runs that synced it.
				ranges.push({
					from: oldest([account.syncCoveredFrom, account.firstSyncedDate])!,
					to: account.lastSyncedDate,
				});
			return {bankAccountId: account.id, source: file ? 'file' : 'sync', ranges: mergeRanges(ranges, asOf)};
		});
	}
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

function coveredThrough(ranges: readonly DateRange[]): string | null {
	return ranges.at(-1)?.to ?? null;
}

function oldest(days: ReadonlyArray<string | null>): string | null {
	return days.reduce<string | null>((first, day) => (day && (!first || day < first) ? day : first), null);
}

function newest(days: ReadonlyArray<string | null>): string | null {
	return days.reduce<string | null>((latest, day) => (day && (!latest || day > latest) ? day : latest), null);
}
