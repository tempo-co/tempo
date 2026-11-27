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

/** Where a sync range starts without recorded coverage: from any day, so no known first day. */
const UNRECORDED_SYNC_START = '0001-01-01';

type AccountCoverage = {bankAccountId: string; source: DataCoverageSource; ranges: DateRange[]};

/**
 * Which days an owner's data covers, per account. A synced account covers its sync history (from its recorded sync
 * coverage, else from any day) through the day of its connection's last successful sync, in the owner's time zone; any
 * account covers the date ranges of its imports that are not undone. No day after `asOf` counts.
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
	 * The oldest day the owner's data is known to cover (an import's first day or a recorded sync coverage start) and
	 * the newest day any account covers, not after `asOf`; each null when none is known.
	 */
	async findCoveredSpan(
		owner: CoverageOwner,
		asOf: string,
	): Promise<{firstCoveredDay: string | null; lastCoveredDay: string | null}> {
		const accounts = await this.findAccountCoverage(owner, asOf);
		const starts = accounts.flatMap(({ranges}) =>
			ranges.flatMap(({from}) => (from === UNRECORDED_SYNC_START ? [] : [from])),
		);
		return {
			firstCoveredDay: starts.reduce<string | null>(
				(oldest, day) => (!oldest || day < oldest ? day : oldest),
				null,
			),
			lastCoveredDay: newest(accounts.map(({ranges}) => coveredThrough(ranges))),
		};
	}

	/** Each account the connection list shows, in its order, with its covered days merged and cut at `asOf`. */
	private async findAccountCoverage(owner: CoverageOwner, asOf: string): Promise<AccountCoverage[]> {
		const manager = this.dataSource.manager;
		const [accounts, imports] = await Promise.all([
			manager.query<
				Array<{id: string; provider: string; syncCoveredFrom: string | null; lastSuccessfulSyncAt: Date | null}>
			>(
				`SELECT bank_account."id", connection."provider",
					to_char(bank_account."syncCoveredFrom", 'YYYY-MM-DD') AS "syncCoveredFrom",
					(SELECT MAX(run."finishedAt") FROM "bank_sync_runs" run
						WHERE run."bankConnectionId" = connection."id" AND run."status" = $2) AS "lastSuccessfulSyncAt"
				FROM "bank_accounts" bank_account
				JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
				WHERE connection."accountId" = $1 AND connection."status" <> ALL($3::varchar[])
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
			if (account.lastSuccessfulSyncAt)
				ranges.push({
					// Without recorded coverage, the sync history counts from its start.
					from: account.syncCoveredFrom ?? UNRECORDED_SYNC_START,
					to: dateInTimeZone(account.lastSuccessfulSyncAt, owner.timeZone),
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

function newest(days: ReadonlyArray<string | null>): string | null {
	return days.reduce<string | null>((latest, day) => (day && (!latest || day > latest) ? day : latest), null);
}
