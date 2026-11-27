import {DataSource, QueryRunner} from 'typeorm';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'AddBankTransactionLeftOutOfTotals20261127090000';

describe('AddBankTransactionLeftOutOfTotals migration', () => {
	it('counts every existing row in totals, notes no history change, and takes the owner’s choice', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const [shop, salary] = await fixtures.createTransactions(bankAccount, [
			bookedRow('2026-08-12', '-50.00'),
			bookedRow('2026-08-25', '2000.00', {category: 'INCOME'}),
		]);

		const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
		expect(migration).toBeDefined();
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			await migration!.down(runner);
			expect(await runner.hasColumn('bank_transactions', 'leftOutOfTotals')).toBe(false);
			const rows = () => runner.query('SELECT to_jsonb(t) AS state FROM bank_transactions t ORDER BY id');
			const before = await rows();
			const changes = () =>
				runner.query(
					`SELECT COALESCE(SUM("weight"), 0)::int AS "weight" FROM "bank_history_changes" WHERE "accountId" = $1`,
					[owner.id],
				);
			const changesBefore = await changes();

			await migration!.up(runner);

			const flags = async () =>
				Object.fromEntries(
					(
						(await runner.query(
							`SELECT "id", "leftOutOfTotals" FROM "bank_transactions" WHERE "id" = ANY($1)`,
							[[shop.id, salary.id]],
						)) as Array<{id: string; leftOutOfTotals: boolean}>
					).map(({id, leftOutOfTotals}) => [id, leftOutOfTotals]),
				);
			expect(await flags()).toEqual({[shop.id]: false, [salary.id]: false});
			const withoutFlag = (states: Array<{state: Record<string, unknown>}>) =>
				states.map(({state: {leftOutOfTotals: _flag, ...rest}}) => rest);
			expect(withoutFlag(await rows())).toEqual(withoutFlag(before));
			// Recurring payments keep their stored detection: the owner's history version is unchanged.
			expect(await changes()).toEqual(changesBefore);

			await runner.query(`UPDATE "bank_transactions" SET "leftOutOfTotals" = true WHERE "id" = $1`, [shop.id]);
			expect(await flags()).toEqual({[shop.id]: true, [salary.id]: false});

			await migration!.down(runner);
			expect(await runner.hasColumn('bank_transactions', 'leftOutOfTotals')).toBe(false);
			await migration!.up(runner);
			expect(await flags()).toEqual({[shop.id]: false, [salary.id]: false});

			// A second run changes nothing.
			const second = await countWrites(runner, () => migration!.up(runner));
			expect(second).toBe(0);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete(connection.id);
		}
	});
});

/** How many `bank_transactions` rows `work` updates, counted by a trigger the caller's transaction rolls back. */
async function countWrites(runner: QueryRunner, work: () => Promise<void>): Promise<number> {
	await runner.query(`CREATE TABLE "migration_test_writes" ("id" uuid)`);
	await runner.query(
		`CREATE FUNCTION "migration_test_count_write"() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN INSERT INTO "migration_test_writes" VALUES (NEW."id"); RETURN NEW; END $$`,
	);
	await runner.query(
		`CREATE TRIGGER "migration_test_count_write" BEFORE UPDATE ON "bank_transactions"
		FOR EACH ROW EXECUTE FUNCTION "migration_test_count_write"()`,
	);
	await work();
	const [{count}] = (await runner.query(`SELECT count(*)::int AS "count" FROM "migration_test_writes"`)) as Array<{
		count: number;
	}>;
	return count;
}
