import {DataSource, QueryRunner} from 'typeorm';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'AddBankAccountBankIdentity20261121090000';

describe('AddBankAccountBankIdentity migration', () => {
	it("records each bank connection's institution name on its accounts and leaves imported-files accounts without one", async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const savings = await fixtures.createBankAccount(connection, {currency: 'USD'});
		const otherBank = await fixtures.createConnection(owner, {aspspName: ' Example  Bank', aspspCountry: 'DE'});
		const otherAccount = await fixtures.createBankAccount(otherBank);
		const files = await fixtures.createConnection(owner, {
			provider: 'file',
			aspspName: 'Imported files',
			aspspCountry: 'ZZ',
		});
		const fileAccount = await fixtures.createBankAccount(files, {providerAccountId: 'file:NL91ABNA0417164300:EUR'});
		await fixtures.createTransaction(bankAccount, {amount: '-12.50', bookingDate: '2026-09-01'});

		const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
		expect(migration).toBeDefined();
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			await migration!.down(runner);
			expect(await runner.hasColumn('bank_accounts', 'bankIdentity')).toBe(false);
			const before = await fingerprints(runner);

			await migration!.up(runner);

			const identities = async () =>
				Object.fromEntries(
					(
						(await runner.query(
							`SELECT "id", "bankIdentity", xmin::text AS "version" FROM "bank_accounts" WHERE "id" = ANY($1)`,
							[[bankAccount.id, savings.id, otherAccount.id, fileAccount.id]],
						)) as Array<{id: string; bankIdentity: string | null; version: string}>
					).map(({id, ...rest}) => [id, rest]),
				);
			const migrated = await identities();
			expect(
				Object.fromEntries(Object.entries(migrated).map(([id, {bankIdentity}]) => [id, bankIdentity])),
			).toEqual({
				[bankAccount.id]: 'name:abn amro',
				[savings.id]: 'name:abn amro',
				[otherAccount.id]: 'name:example bank',
				[fileAccount.id]: null,
			});
			expect(await fingerprints(runner)).toEqual(before);

			// A second run writes no row.
			await migration!.up(runner);
			expect(await identities()).toEqual(migrated);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete([connection.id, otherBank.id, files.id]);
		}
	});
});

/** Row count and an md5 over the rows of the tables the migration must not change, over the columns before it. */
async function fingerprints(runner: QueryRunner) {
	const result: Record<string, unknown> = {};
	for (const table of ['bank_accounts', 'bank_connections', 'bank_transactions']) {
		const columns = (
			(await runner.query(
				`SELECT column_name FROM information_schema.columns
				WHERE table_name = $1 AND column_name <> 'bankIdentity' ORDER BY column_name`,
				[table],
			)) as Array<{column_name: string}>
		).map(({column_name}) => `"${column_name}"`);
		result[table] = await runner.query(
			`SELECT count(*)::int AS "rows", md5(coalesce(string_agg(row_text, '|' ORDER BY row_text), '')) AS "hash"
			FROM (SELECT ROW(${columns.join(', ')})::text AS row_text FROM "${table}") rows`,
		);
	}
	return result;
}
