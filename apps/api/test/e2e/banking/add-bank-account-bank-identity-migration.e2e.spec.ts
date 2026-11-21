import {DataSource, QueryRunner} from 'typeorm';

import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '@modules/banking/bank-transaction-financial-event';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'AddBankAccountBankIdentity20261121090000';
const EXCHANGE_PAIRING_MIGRATION_NAME = 'AddCurrencyExchangePairing20261004120000';

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
			expect(await runner.hasColumn('bank_accounts', 'bankIdentityImportId')).toBe(false);
			const before = await fingerprints(runner);

			await migration!.up(runner);

			const identities = async () =>
				Object.fromEntries(
					(
						(await runner.query(`SELECT "id", "bankIdentity" FROM "bank_accounts" WHERE "id" = ANY($1)`, [
							[bankAccount.id, savings.id, otherAccount.id, fileAccount.id],
						])) as Array<{id: string; bankIdentity: string | null}>
					).map(({id, bankIdentity}) => [id, bankIdentity]),
				);
			const migrated = {
				[bankAccount.id]: 'name:abn amro',
				[savings.id]: 'name:abn amro',
				[otherAccount.id]: 'name:example bank',
				[fileAccount.id]: null,
			};
			expect(await identities()).toEqual(migrated);
			expect(await fingerprints(runner)).toEqual(before);

			// The migrated schema takes the column as the import writes it.
			await runner.query(`UPDATE "bank_accounts" SET "bankIdentity" = 'bic:EXMPDEFF' WHERE "id" = $1`, [
				fileAccount.id,
			]);
			expect((await identities())[fileAccount.id]).toBe('bic:EXMPDEFF');

			await migration!.down(runner);
			expect(await runner.hasColumn('bank_accounts', 'bankIdentity')).toBe(false);
			await migration!.up(runner);
			expect(await identities()).toEqual(migrated);

			// A second run writes no row.
			const writes = await countWrites(runner, () => migration!.up(runner));
			expect(writes).toBe(0);
			expect(await identities()).toEqual(migrated);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete([connection.id, otherBank.id, files.id]);
		}
	});

	it('lets an upgrade from before exchange pairing pair the existing history before the column exists', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const usd = await fixtures.createBankAccount(connection, {currency: 'USD'});
		const [debit, credit] = [
			await fixtures.createTransaction(bankAccount, {
				amount: '-10.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				bookingDate: '2026-01-10',
				description: 'Exchanged to USD',
			}),
			await fixtures.createTransaction(usd, {
				amount: '12.00',
				currency: 'USD',
				creditDebitIndicator: 'CRDT',
				bookingDate: '2026-01-10',
				description: 'Exchanged to USD',
			}),
		];
		const identity = ds.migrations.find(({name}) => name === MIGRATION_NAME)!;
		const pairing = ds.migrations.find(({name}) => name === EXCHANGE_PAIRING_MIGRATION_NAME)!;
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			// The schema before both migrations, with history in it.
			await identity.down(runner);
			await pairing.down(runner);
			expect(await runner.hasColumn('bank_transactions', 'currencyExchangeCounterpartId')).toBe(false);

			await pairing.up(runner);

			const legs = (await runner.query(
				`SELECT "id", "financialEventType", "currencyExchangeCounterpartId" FROM "bank_transactions"
				WHERE "id" = ANY($1) ORDER BY "currency"`,
				[[debit.id, credit.id]],
			)) as Array<{id: string; financialEventType: string | null; currencyExchangeCounterpartId: string | null}>;
			expect(legs).toEqual([
				{
					id: debit.id,
					financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
					currencyExchangeCounterpartId: credit.id,
				},
				{
					id: credit.id,
					financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
					currencyExchangeCounterpartId: debit.id,
				},
			]);
			await identity.up(runner);
			expect(await runner.hasColumn('bank_accounts', 'bankIdentity')).toBe(true);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete(connection.id);
		}
	});
});

/** How many `bank_accounts` rows `work` updates, counted by a trigger the caller's transaction rolls back. */
async function countWrites(runner: QueryRunner, work: () => Promise<void>): Promise<number> {
	await runner.query(`CREATE TABLE "migration_test_writes" ("id" uuid)`);
	await runner.query(
		`CREATE FUNCTION "migration_test_count_write"() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN INSERT INTO "migration_test_writes" VALUES (NEW."id"); RETURN NEW; END $$`,
	);
	await runner.query(
		`CREATE TRIGGER "migration_test_count_write" BEFORE UPDATE ON "bank_accounts"
		FOR EACH ROW EXECUTE FUNCTION "migration_test_count_write"()`,
	);
	await work();
	const [{count}] = (await runner.query(`SELECT count(*)::int AS "count" FROM "migration_test_writes"`)) as Array<{
		count: number;
	}>;
	return count;
}

/** Row count and an md5 over the rows of the tables the migration must not change, over the columns before it. */
async function fingerprints(runner: QueryRunner) {
	const result: Record<string, unknown> = {};
	for (const table of ['bank_accounts', 'bank_connections', 'bank_transactions']) {
		const columns = (
			(await runner.query(
				`SELECT column_name FROM information_schema.columns
				WHERE table_name = $1 AND column_name NOT IN ('bankIdentity', 'bankIdentityImportId') ORDER BY column_name`,
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
