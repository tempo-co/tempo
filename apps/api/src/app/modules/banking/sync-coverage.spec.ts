import {EnableBankingTransaction, EnableBankingTransactionFetchOptions} from './enable-banking.types';
import {
	INCREMENTAL_OVERLAP_DAYS,
	SYNC_FINAL_MARGIN_DAYS,
	SyncCoverage,
	extendSyncCoverage,
	finalSyncDays,
	isFinalSyncDay,
	recordsSyncCoverage,
} from './sync-coverage';

const TODAY = '2026-11-14';

function rows(...dates: Array<Partial<EnableBankingTransaction>>): EnableBankingTransaction[] {
	return dates.map((fields) => ({amount: '1.00', currency: 'EUR', ...fields}));
}

describe('extendSyncCoverage', () => {
	it.each<
		[string, SyncCoverage | null, EnableBankingTransactionFetchOptions, EnableBankingTransaction[], SyncCoverage]
	>([
		[
			'a first longest fetch covers from the day after its earliest row',
			null,
			{strategy: 'longest'},
			rows({bookingDate: '2026-08-26'}, {bookingDate: '2026-08-22'}),
			{from: '2026-08-23', through: TODAY},
		],
		[
			'a longest fetch without rows covers only the fetch day',
			null,
			{strategy: 'longest'},
			[],
			{from: TODAY, through: TODAY},
		],
		[
			'a longest fetch whose earliest row is today covers only the fetch day',
			null,
			{strategy: 'longest'},
			rows({bookingDate: TODAY}),
			{from: TODAY, through: TODAY},
		],
		[
			'a longest fetch from a date covers from that date when its rows start earlier',
			null,
			{strategy: 'longest', dateFrom: '2026-09-01'},
			rows({bookingDate: '2026-08-20'}),
			{from: '2026-09-01', through: TODAY},
		],
		[
			'a longest fetch from a date covers from the day after its earliest row when the bank served less',
			null,
			{strategy: 'longest', dateFrom: '2026-07-01'},
			rows({bookingDate: '2026-08-20'}),
			{from: '2026-08-21', through: TODAY},
		],
		[
			'a row without a booking date counts by its value date, else its transaction date',
			null,
			{strategy: 'longest'},
			rows({valueDate: '2026-08-10'}, {transactionDate: '2026-08-05'}, {}),
			{from: '2026-08-06', through: TODAY},
		],
		[
			'a default fetch covers from the date it asked for',
			null,
			{strategy: 'default', dateFrom: '2026-11-01'},
			[],
			{from: '2026-11-01', through: TODAY},
		],
		[
			'a fetch that starts inside the range extends it',
			{from: '2026-08-23', through: '2026-11-10'},
			{strategy: 'default', dateFrom: '2026-11-03'},
			[],
			{from: '2026-08-23', through: TODAY},
		],
		[
			'a fetch that starts the day after the range extends it',
			{from: '2026-08-23', through: '2026-11-10'},
			{strategy: 'default', dateFrom: '2026-11-11'},
			[],
			{from: '2026-08-23', through: TODAY},
		],
		[
			'a fetch that starts before the range moves its start back',
			{from: '2026-08-23', through: '2026-11-10'},
			{strategy: 'default', dateFrom: '2026-08-20'},
			[],
			{from: '2026-08-20', through: TODAY},
		],
		[
			'a fetch that starts after a gap restarts the range',
			{from: '2026-03-01', through: '2026-05-01'},
			{strategy: 'default', dateFrom: '2026-05-03'},
			[],
			{from: '2026-05-03', through: TODAY},
		],
		[
			'a longest fetch after a gap the bank no longer serves restarts the range after its earliest row',
			{from: '2026-03-01', through: '2026-05-01'},
			{strategy: 'longest', dateFrom: '2026-04-24'},
			rows({bookingDate: '2026-08-16'}),
			{from: '2026-08-17', through: TODAY},
		],
	])('%s', (_name, previous, options, transactions, expected) => {
		expect(extendSyncCoverage(previous, {options, transactions, fetchedOn: TODAY})).toEqual(expected);
	});
});

describe('recordsSyncCoverage', () => {
	it.each([
		['enable-banking', true],
		['file', false],
		['another-provider', false],
	])('provider %s records coverage: %s', (provider, expected) => {
		expect(recordsSyncCoverage(provider)).toBe(expected);
	});
});

describe('finalSyncDays', () => {
	const covered = {
		provider: 'enable-banking',
		syncCoveredFrom: '2026-03-01',
		syncCoveredThrough: '2026-05-31',
		oldestPendingDay: null,
	};

	it.each<[string, Partial<Parameters<typeof finalSyncDays>[0]>, ReturnType<typeof finalSyncDays>]>([
		[
			'are the covered days without the first and last eight, which sync may still read again',
			{},
			{from: '2026-03-09', through: '2026-05-23'},
		],
		[
			'end the day before the oldest pending row',
			{oldestPendingDay: '2026-04-10'},
			{from: '2026-03-09', through: '2026-04-09'},
		],
		[
			'ignore a pending row in the newest eight days',
			{oldestPendingDay: '2026-05-25'},
			{from: '2026-03-09', through: '2026-05-23'},
		],
		['are none when a pending row sits before them', {oldestPendingDay: '2026-03-05'}, null],
		[
			'are none when the range is too short for both margins',
			{syncCoveredFrom: '2026-05-15', syncCoveredThrough: '2026-05-30'},
			null,
		],
		[
			'are one day when the range is exactly long enough',
			{syncCoveredFrom: '2026-05-15', syncCoveredThrough: '2026-05-31'},
			{from: '2026-05-23', through: '2026-05-23'},
		],
		['are none without coverage', {syncCoveredFrom: null, syncCoveredThrough: null}, null],
		['are none for imported files', {provider: 'file'}, null],
		['are none for a provider that records no coverage', {provider: 'another-provider'}, null],
	])('final days %s', (_name, overrides, expected) => {
		expect(finalSyncDays({...covered, ...overrides})).toEqual(expected);
	});

	it('margins are the overlap the incremental fetch reads again plus the fetch day', () => {
		expect(SYNC_FINAL_MARGIN_DAYS).toBe(INCREMENTAL_OVERLAP_DAYS + 1);
	});
});

describe('isFinalSyncDay', () => {
	const range = {from: '2026-03-09', through: '2026-05-23'};
	it.each<[string | null, typeof range | null, boolean]>([
		['2026-03-09', range, true],
		['2026-05-23', range, true],
		['2026-03-08', range, false],
		['2026-05-24', range, false],
		[null, range, false],
		['2026-04-01', null, false],
	])('%s in %j: %s', (day, finalDays, expected) => {
		expect(isFinalSyncDay(day, finalDays)).toBe(expected);
	});
});
