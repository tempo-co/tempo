import {DataSource, QueryRunner} from 'typeorm';

import {createBankTransactionStableIdentityKeyForGroup} from '@modules/banking/bank-transaction-identity';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'RequireBankTransactionIdentity20261112210000';

describe('RequireBankTransactionIdentity migration', () => {
	it('completes missing identities as sync assigns them, then requires them and drops the dedupe key', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const otherBankAccount = await fixtures.createBankAccount(connection);
		const repeated = {bookingDate: '2026-09-01', amount: '-12.5', description: 'Example repeated payment'};
		const [first, repeat, undated, moved, displaced] = await fixtures.createTransactions(bankAccount, [
			repeated,
			{...repeated, amount: '-12.50', description: 'Example repeated payment, edited'},
			{
				bookingDate: null,
				transactionDate: '2026-09-02',
				amount: '7',
				currency: 'eur',
				creditDebitIndicator: 'crdt',
			},
			{bookingDate: '2026-09-03', amount: '-3.00'},
			{bookingDate: '2026-09-04', amount: '-4.00'},
		]);
		const otherAccountRepeat = await fixtures.createTransaction(otherBankAccount, repeated);
		const occurrence = (row: {stableIdentityGroupKey: string}, number: number) =>
			createBankTransactionStableIdentityKeyForGroup(row.stableIdentityGroupKey, number);
		// What sync stored before: occurrence 1 of each group, and a row that kept its key after moving group.
		await fixtures.transactions.update(first.id, {stableIdentityKey: occurrence(first, 1)});
		await fixtures.transactions.update(moved.id, {stableIdentityKey: occurrence(displaced, 1)});
		const ourIds = [first, repeat, undated, moved, displaced, otherAccountRepeat].map(({id}) => id);

		const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
		expect(migration).toBeDefined();
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			await migration!.down(runner);
			expect(await identitySchema(runner)).toEqual({
				dedupeKey: 'NO',
				stableIdentityGroupKey: 'YES',
				stableIdentityKey: 'YES',
				dedupeIndex: true,
			});
			await runner.query(
				`UPDATE bank_transactions SET "stableIdentityKey" = NULL, "stableIdentityGroupKey" = NULL
				WHERE id = ANY($1::uuid[])`,
				[[repeat.id, otherAccountRepeat.id]],
			);
			await runner.query(
				`UPDATE bank_transactions SET "stableIdentityKey" = '', "stableIdentityGroupKey" = '' WHERE id = $1`,
				[undated.id],
			);
			await runner.query('UPDATE bank_transactions SET "stableIdentityKey" = NULL WHERE id = $1', [displaced.id]);
			const otherRows = () =>
				runner.query(
					`SELECT to_jsonb(t) - 'dedupeKey' AS state FROM bank_transactions t
					WHERE NOT (id = ANY($1::uuid[])) ORDER BY id`,
					[ourIds],
				);
			const before = {otherRows: await otherRows(), tables: await otherTables(ds, runner)};

			await migration!.up(runner);

			const identities = async () =>
				new Map(
					(
						(await runner.query(
							`SELECT id, "stableIdentityGroupKey", "stableIdentityKey" FROM bank_transactions
							WHERE id = ANY($1::uuid[])`,
							[ourIds],
						)) as Array<{id: string; stableIdentityGroupKey: string; stableIdentityKey: string}>
					).map(({id, ...identity}) => [id, identity]),
				);
			// Expected keys come from the live identity code: the migration's frozen copy must agree with it.
			expect(Object.fromEntries(await identities())).toEqual({
				[first.id]: {
					stableIdentityGroupKey: first.stableIdentityGroupKey,
					stableIdentityKey: occurrence(first, 1),
				},
				[repeat.id]: {
					stableIdentityGroupKey: first.stableIdentityGroupKey,
					stableIdentityKey: occurrence(first, 2),
				},
				[undated.id]: {
					stableIdentityGroupKey: undated.stableIdentityGroupKey,
					stableIdentityKey: occurrence(undated, 1),
				},
				[moved.id]: {
					stableIdentityGroupKey: moved.stableIdentityGroupKey,
					stableIdentityKey: occurrence(displaced, 1),
				},
				[displaced.id]: {
					stableIdentityGroupKey: displaced.stableIdentityGroupKey,
					stableIdentityKey: occurrence(displaced, 2),
				},
				[otherAccountRepeat.id]: {
					stableIdentityGroupKey: otherAccountRepeat.stableIdentityGroupKey,
					stableIdentityKey: occurrence(otherAccountRepeat, 1),
				},
			});
			expect(repeat.stableIdentityGroupKey).toBe(first.stableIdentityGroupKey);
			expect(otherAccountRepeat.stableIdentityGroupKey).not.toBe(first.stableIdentityGroupKey);
			expect(await identitySchema(runner)).toEqual({
				stableIdentityGroupKey: 'NO',
				stableIdentityKey: 'NO',
				dedupeIndex: false,
			});
			await runner.query('SAVEPOINT clear_identity');
			await expect(
				runner.query('UPDATE bank_transactions SET "stableIdentityKey" = NULL WHERE id = $1', [first.id]),
			).rejects.toThrow('violates not-null constraint');
			await runner.query('ROLLBACK TO SAVEPOINT clear_identity');
			expect(await otherRows()).toEqual(before.otherRows);
			expect(await otherTables(ds, runner)).toEqual(before.tables);

			const migrated = await runner.query(
				'SELECT to_jsonb(t) AS state, ctid::text AS tuple FROM bank_transactions t',
			);
			await migration!.up(runner);
			expect(
				await runner.query('SELECT to_jsonb(t) AS state, ctid::text AS tuple FROM bank_transactions t'),
			).toEqual(migrated);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete(connection.id);
		}
	});
});

async function identitySchema(runner: QueryRunner) {
	const columns: Array<{column_name: string; is_nullable: string}> = await runner.query(
		`SELECT column_name, is_nullable FROM information_schema.columns
		WHERE table_name = 'bank_transactions'
			AND column_name IN ('dedupeKey', 'stableIdentityKey', 'stableIdentityGroupKey')
		ORDER BY column_name`,
	);
	const [{dedupeIndex}] = await runner.query(
		`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bank_transactions_account_dedupe') AS "dedupeIndex"`,
	);
	return {
		...Object.fromEntries(columns.map(({column_name, is_nullable}) => [column_name, is_nullable])),
		dedupeIndex,
	};
}

async function otherTables(ds: DataSource, runner: QueryRunner) {
	const tables: Array<{tablename: string}> = await runner.query(
		"SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'bank_transactions' ORDER BY tablename",
	);
	const states = [];
	for (const {tablename} of tables) {
		const [state] = await runner.query(
			`SELECT COUNT(*)::int AS count, md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS hash FROM ${ds.driver.escape(tablename)} t`,
		);
		states.push({tablename, ...state});
	}
	return states;
}
