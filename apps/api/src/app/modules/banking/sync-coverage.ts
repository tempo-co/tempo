import {addDays} from './banking.utils';
import {EnableBankingTransaction, EnableBankingTransactionFetchOptions} from './enable-banking.types';
import {BANK_CONNECTION_PROVIDERS} from './services/banking-sync.constants';

/** The days an incremental fetch reads again before the account's last complete fetch. */
export const INCREMENTAL_OVERLAP_DAYS = 7;

/**
 * Providers whose sync records coverage: every fetch goes through Tempo, so a complete one is known to be complete.
 * A provider that fetches from the bank on its own schedule (such as Synci) must not be added until its fetch time,
 * how far back it reads again and whether its syncs can be partial are known.
 */
const SYNC_COVERAGE_PROVIDERS: ReadonlySet<string> = new Set([BANK_CONNECTION_PROVIDERS.ENABLE_BANKING]);

export function recordsSyncCoverage(provider: string): boolean {
	return SYNC_COVERAGE_PROVIDERS.has(provider);
}

/** The contiguous days an account's complete transaction fetches covered, both ends included. */
export type SyncCoverage = {from: string; through: string};

export type CompleteTransactionFetch = {
	options: EnableBankingTransactionFetchOptions;
	transactions: EnableBankingTransaction[];
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
