import {GroupAccount, recordedAccounts} from './recorded-accounts';

const group = (fields: Partial<GroupAccount> & Pick<GroupAccount, 'bankAccountId'>): GroupAccount => ({
	created: false,
	fromFiles: true,
	closingBalance: null,
	...fields,
});

describe('recordedAccounts', () => {
	it('records an account two groups of a drop reach once, with the newest closing balance either states', () => {
		expect(
			recordedAccounts([
				group({bankAccountId: 'file-a', created: true, closingBalance: {date: '2026-03-04', amount: '10.00'}}),
				group({
					bankAccountId: 'synced-b',
					fromFiles: false,
					closingBalance: {date: '2026-03-09', amount: '7.00'},
				}),
				group({bankAccountId: 'file-a', closingBalance: {date: '2026-03-31', amount: '25.50'}}),
				group({bankAccountId: 'file-c', closingBalance: {date: '2026-03-31', amount: '1.00'}}),
				group({bankAccountId: 'file-c', closingBalance: {date: '2026-03-31', amount: '2.00'}}),
				group({bankAccountId: 'file-c', closingBalance: {date: '2026-03-02', amount: '3.00'}}),
			]),
		).toEqual({
			bankAccountIds: ['file-a', 'synced-b', 'file-c'],
			createdBankAccountIds: ['file-a'],
			// A synced account takes its balance from bank sync, never from a file.
			closingBalances: [
				{bankAccountId: 'file-a', date: '2026-03-31', amount: '25.50'},
				{bankAccountId: 'file-c', date: '2026-03-31', amount: '1.00'},
			],
		});
	});
});
