import {addDays} from './banking.utils';
import type {EnableBankingTransaction, EnableBankingTransactionFetchOptions} from './enable-banking.types';
import {BANK_CONNECTION_PROVIDERS} from './services/banking-sync.constants';

/** The days an incremental fetch reads again before the account's last complete fetch. */
export const INCREMENTAL_OVERLAP_DAYS = 7;

/**
 * Providers whose sync records coverage: every fetch goes through Wisp, so a complete one is known to be complete.
 * A provider that fetches from the bank on its own schedule (such as Synci) must not be added until its fetch time,
 * how far back it reads again and whether its syncs can be partial are known.
 */
const SYNC_COVERAGE_PROVIDERS: ReadonlySet<string> = new Set([BANK_CONNECTION_PROVIDERS.ENABLE_BANKING]);

export function recordsSyncCoverage(provider: string): boolean {
	return SYNC_COVERAGE_PROVIDERS.has(provider);
}

/**
 * How many days at each end of an account's coverage are not final. The incremental fetch starts
 * `INCREMENTAL_OVERLAP_DAYS` before the last complete fetch, so it reads the newest 8 days again: a day is final once
 * no future fetch asks for it. The same margin after the start keeps a payment that a file dates by its purchase day
 * and sync by its booking day (or the other way round) on the same side of the edge.
 */
export const SYNC_FINAL_MARGIN_DAYS = INCREMENTAL_OVERLAP_DAYS + 1;

/** The days on which bank sync is final, both ends included. */
export type FinalSyncDays = {from: string; through: string};

/**
 * The days on which an account's bank sync is final: its coverage without the first and last
 * `SYNC_FINAL_MARGIN_DAYS`, and never on or after its oldest pending row, which sync reads again until it books.
 * Null for an account without coverage, an imported-files account or a provider that records none.
 */
export function finalSyncDays({
	provider,
	syncCoveredFrom,
	syncCoveredThrough,
	oldestPendingDay,
}: {
	provider: string;
	syncCoveredFrom: string | null;
	syncCoveredThrough: string | null;
	oldestPendingDay: string | null;
}): FinalSyncDays | null {
	if (!recordsSyncCoverage(provider) || !syncCoveredFrom || !syncCoveredThrough) return null;
	const from = addDays(syncCoveredFrom, SYNC_FINAL_MARGIN_DAYS);
	const beforeMargin = addDays(syncCoveredThrough, -SYNC_FINAL_MARGIN_DAYS);
	const beforePending = oldestPendingDay ? addDays(oldestPendingDay, -1) : null;
	const through = beforePending && beforePending < beforeMargin ? beforePending : beforeMargin;
	return through >= from ? {from, through} : null;
}

export function isFinalSyncDay(day: string | null, finalDays: FinalSyncDays | null): boolean {
	return day !== null && finalDays !== null && day >= finalDays.from && day <= finalDays.through;
}

/** The contiguous days an account's complete transaction fetches covered, both ends included. */
export type SyncCoverage = {from: string; through: string};

export type CompleteTransactionFetch = {
	options: EnableBankingTransactionFetchOptions;
	transactions: readonly EnableBankingTransaction[];
	/** The fetch's date in the app's time zone. */
	fetchedOn: string;
};

/**
 * The account's coverage once a complete fetch (every page fetched, every row readable) is recorded. A `default`
 * fetch covers from the date it asked for: the bank serves it or refuses the request. A `longest` fetch covers from
 * the later of its requested start and the day after its earliest row, since the bank never says how far back it
 * served. A fetch that starts no later than the day after the range extends it; one that starts later leaves a gap
 * the bank did not fill, and the range starts again with it.
 */
export function extendSyncCoverage(previous: SyncCoverage | null, fetch: CompleteTransactionFetch): SyncCoverage {
	const fetchFrom = minDate(coveredFrom(fetch), fetch.fetchedOn);
	if (!previous || fetchFrom > addDays(previous.through, 1)) return {from: fetchFrom, through: fetch.fetchedOn};
	return {
		from: minDate(previous.from, fetchFrom),
		through: previous.through > fetch.fetchedOn ? previous.through : fetch.fetchedOn,
	};
}

function coveredFrom({options, transactions, fetchedOn}: CompleteTransactionFetch): string {
	if (options.strategy === 'default' && options.dateFrom) return options.dateFrom;
	const earliestRow = transactions
		.map((transaction) => transaction.bookingDate ?? transaction.valueDate ?? transaction.transactionDate)
		.filter((date): date is string => date !== undefined)
		.reduce<string | null>((earliest, date) => (earliest === null || date < earliest ? date : earliest), null);
	const afterEarliestRow = earliestRow === null ? fetchedOn : addDays(earliestRow, 1);
	return options.dateFrom && options.dateFrom > afterEarliestRow ? options.dateFrom : afterEarliestRow;
}

function minDate(left: string, right: string): string {
	return left < right ? left : right;
}
