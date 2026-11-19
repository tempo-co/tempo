import {DataSource, QueryRunner} from 'typeorm';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'RequireBankTransactionCreditDebitIndicator20261119120000';

describe('RequireBankTransactionCreditDebitIndicator migration', () => {
	it('requires every row to be a credit or a debit and leaves the rows unchanged', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const [debit] = await fixtures.createTransactions(bankAccount, [
			{bookingDate: '2026-09-01', amount: '-12.50', creditDebitIndicator: 'DBIT'},
			{bookingDate: '2026-09-02', amount: '7.00', creditDebitIndicator: 'CRDT'},
		]);

		const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
		expect(migration).toBeDefined();
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			await migration!.down(runner);
			expect(await indicatorSchema(runner)).toEqual({nullable: 'YES', constraint: false});
			const rows = () => runner.query('SELECT to_jsonb(t) AS state FROM bank_transactions t ORDER BY id');
			const before = await rows();

			await migration!.up(runner);

			expect(await indicatorSchema(runner)).toEqual({nullable: 'NO', constraint: true});
			expect(await rows()).toEqual(before);
			for (const value of [null, 'UNKNOWN']) {
				await runner.query('SAVEPOINT write_indicator');
				await expect(
					runner.query('UPDATE bank_transactions SET "creditDebitIndicator" = $1 WHERE id = $2', [
						value,
						debit.id,
					]),
				).rejects.toThrow(/violates (not-null|check) constraint/);
				await runner.query('ROLLBACK TO SAVEPOINT write_indicator');
			}

			await migration!.up(runner);
			expect(await indicatorSchema(runner)).toEqual({nullable: 'NO', constraint: true});
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete(connection.id);
		}
	});
});

async function indicatorSchema(runner: QueryRunner) {
	const [{nullable, constraint}] = await runner.query(
		`SELECT
			(SELECT is_nullable FROM information_schema.columns
				WHERE table_name = 'bank_transactions' AND column_name = 'creditDebitIndicator') AS nullable,
			EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_transactions_credit_debit_indicator') AS "constraint"`,
	);
	return {nullable, constraint};
}
