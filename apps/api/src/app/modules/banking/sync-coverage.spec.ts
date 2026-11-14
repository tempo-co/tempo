import {EnableBankingTransaction, EnableBankingTransactionFetchOptions} from './enable-banking.types';
import {SyncCoverage, extendSyncCoverage, recordsSyncCoverage} from './sync-coverage';

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
