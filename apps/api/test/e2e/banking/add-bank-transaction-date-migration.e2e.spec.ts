import {DataSource, QueryRunner} from 'typeorm';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'AddBankTransactionDate20261120090000';

describe('AddBankTransactionDate migration', () => {
	it('dates every row by its transaction date, else its booking date, else its value date, and keeps it current', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const [paidEarlier, bookedOnly, valueOnly] = await fixtures.createTransactions(bankAccount, [
			{transactionDate: '2026-08-29', bookingDate: '2026-09-01', valueDate: '2026-09-01', amount: '-12.50'},
			{transactionDate: null, bookingDate: '2026-09-02', valueDate: '2026-09-03', amount: '-7.00'},
			{transactionDate: null, bookingDate: null, valueDate: '2026-09-04', amount: '-3.00'},
		]);

		const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
		expect(migration).toBeDefined();
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			await migration!.down(runner);
			expect(await dateSchema(runner)).toEqual({column: false, index: false});
			const rows = () => runner.query('SELECT to_jsonb(t) AS state FROM bank_transactions t ORDER BY id');
			const before = await rows();

			await migration!.up(runner);

			expect(await dateSchema(runner)).toEqual({column: true, index: true});
			const dates = async () =>
				Object.fromEntries(
					(
						(await runner.query(
							`SELECT id, to_char("date", 'YYYY-MM-DD') AS date FROM bank_transactions WHERE id = ANY($1)`,
							[[paidEarlier.id, bookedOnly.id, valueOnly.id]],
						)) as Array<{id: string; date: string}>
					).map(({id, date}) => [id, date]),
				);
			expect(await dates()).toEqual({
				[paidEarlier.id]: '2026-08-29',
				[bookedOnly.id]: '2026-09-02',
				[valueOnly.id]: '2026-09-04',
			});
			const withoutDate = (states: Array<{state: Record<string, unknown>}>) =>
				states.map(({state: {date: _date, ...rest}}) => rest);
			expect(withoutDate(await rows())).toEqual(withoutDate(before));

			await runner.query(`UPDATE bank_transactions SET "transactionDate" = '2026-09-01' WHERE id = $1`, [
				bookedOnly.id,
			]);
			expect((await dates())[bookedOnly.id]).toBe('2026-09-01');

			await migration!.up(runner);
			expect(await dateSchema(runner)).toEqual({column: true, index: true});
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete(connection.id);
		}
	});
});

async function dateSchema(runner: QueryRunner) {
	const [{column, index}] = await runner.query(
		`SELECT
			EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name = 'bank_transactions' AND column_name = 'date' AND is_generated = 'ALWAYS') AS "column",
			EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_transactions_account_date') AS "index"`,
	);
	return {column, index};
}
