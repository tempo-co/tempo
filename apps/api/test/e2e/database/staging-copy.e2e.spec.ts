import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DataSource} from 'typeorm';

import {installSchemaExtras} from '@core/database/synchronized-schema-extras';

import {getApp} from '../../setup/e2e.setup';

const COPY_DATABASE = 'wisp_staging_copy';
// The filter the production server's staging-copy job runs on a restored backup.
const FILTER_SQL = readFileSync(join(__dirname, '../../../wisp-staging-copy.sql'), 'utf8');
// Reference data no account owns; the copy keeps it whole.
const GLOBAL_TABLES = ['bank_transaction_fx_rates', 'migrations', 'typeorm_metadata'];
const LOGOS = 'merchant_logos';

type Snapshot = Map<string, string[]>;

describe('Staging copy filter', () => {
	let copy: DataSource;
	let ownerId: string;
	let otherId: string;
	let ownerRows: Snapshot;
	let allRows: Snapshot;

	beforeEach(async () => {
		const testDataSource = getApp().get(DataSource);
		await copy?.destroy();
		await testDataSource.query(`DROP DATABASE IF EXISTS "${COPY_DATABASE}"`);
		await testDataSource.query(`CREATE DATABASE "${COPY_DATABASE}"`);
		copy = new DataSource({
			...testDataSource.options,
			database: COPY_DATABASE,
			synchronize: false,
			dropSchema: false,
			migrationsRun: false,
		} as typeof testDataSource.options);
		await copy.initialize();
		await copy.synchronize();
		await installSchemaExtras(copy);

		await copy.query(
			`INSERT INTO "bank_transaction_fx_rates" ("currency", "rateDate", "rateToEur", "provider") VALUES ('USD', '2026-01-02', 0.9, 'test')`,
		);
		await copy.query(`INSERT INTO "merchant_logos" ("domain") VALUES ('shared-shop.example')`);
		ownerId = await seedAccount(copy, 'owner');
		ownerRows = await snapshot(copy);
		otherId = await seedAccount(copy, 'other');
		await copy.query(`INSERT INTO "merchant_logos" ("domain") VALUES ('unused-shop.example')`);
		allRows = await snapshot(copy);
	});

	afterAll(async () => {
		await copy?.destroy();
		await getApp().get(DataSource).query(`DROP DATABASE IF EXISTS "${COPY_DATABASE}" WITH (FORCE)`);
	});

	it('keeps exactly the configured account, its rows, the logos its merchants use and all reference data', async () => {
		const accountTables = [...allRows.keys()].filter((table) => !GLOBAL_TABLES.includes(table) && table !== LOGOS);
		for (const table of accountTables) {
			expect({table, ownerRows: ownerRows.get(table)!.length > 0}).toEqual({table, ownerRows: true});
			expect({table, otherRows: allRows.get(table)!.length > ownerRows.get(table)!.length}).toEqual({
				table,
				otherRows: true,
			});
		}
		expect(allRows.get('bank_transaction_fx_rates')).toHaveLength(1);

		await runFilter(copy, ownerId);

		const kept = await snapshot(copy);
		expect(await copy.query(`SELECT "id" FROM "accounts"`)).toEqual([{id: ownerId}]);
		for (const table of accountTables)
			expect({table, rows: kept.get(table)}).toEqual({table, rows: ownerRows.get(table)});
		for (const table of GLOBAL_TABLES.filter((name) => allRows.has(name))) {
			expect({table, rows: kept.get(table)}).toEqual({table, rows: allRows.get(table)});
		}
		const logos = (await copy.query(`SELECT "domain" FROM "merchant_logos" ORDER BY "domain"`)) as Array<{
			domain: string;
		}>;
		expect(logos.map(({domain}) => domain)).toEqual(['owner-shop.example', 'shared-shop.example']);
	});

	it('refuses a database with a table that has no rule and changes nothing', async () => {
		await copy.query(`CREATE TABLE "unruled_notes" ("id" integer PRIMARY KEY, "accountId" uuid)`);
		await copy.query(`INSERT INTO "unruled_notes" VALUES (1, $1)`, [otherId]);

		await expect(runFilter(copy, ownerId)).rejects.toThrow(/no staging copy rule for: public\.unruled_notes/);

		const after = await snapshot(copy);
		for (const [table, rows] of allRows) expect({table, rows: after.get(table)}).toEqual({table, rows});
	});

	it('refuses an owner account the database does not hold and changes nothing', async () => {
		await expect(runFilter(copy, randomUUID())).rejects.toThrow(/owner account .* not found/);

		const after = await snapshot(copy);
		for (const [table, rows] of allRows) expect({table, rows: after.get(table)}).toEqual({table, rows});
	});
});

async function runFilter(dataSource: DataSource, ownerId: string): Promise<void> {
	const runner = dataSource.createQueryRunner();
	try {
		await runner.query(`SELECT set_config('staging_copy.owner_account_id', $1, false)`, [ownerId]);
		await runner.query(FILTER_SQL);
	} finally {
		await runner.release();
	}
}

/** Every table's primary keys, sorted, so rows compare across the filter even when other columns change. */
async function snapshot(dataSource: DataSource): Promise<Snapshot> {
	const tables = (await dataSource.query(
		`SELECT "tablename" FROM pg_tables WHERE "schemaname" = 'public' ORDER BY "tablename"`,
	)) as Array<{tablename: string}>;
	const rows: Snapshot = new Map();
	for (const {tablename} of tables) {
		const keyColumns = (await dataSource.query(
			`SELECT a."attname" FROM pg_index i
			JOIN pg_attribute a ON a."attrelid" = i."indrelid" AND a."attnum" = ANY(i."indkey")
			WHERE i."indrelid" = format('public.%I', $1::text)::regclass AND i."indisprimary"
			ORDER BY a."attname"`,
			[tablename],
		)) as Array<{attname: string}>;
		const key = keyColumns.length
			? keyColumns.map(({attname}) => `"${attname}"::text`).join(` || '|' || `)
			: `t::text`;
		const keys = (await dataSource.query(`SELECT ${key} AS "key" FROM "${tablename}" t ORDER BY 1`)) as Array<{
			key: string;
		}>;
		rows.set(
			tablename,
			keys.map(({key: value}) => value),
		);
	}
	return rows;
}

/** One account with a row in every table an account owns; `label` keeps its unique values apart. */
async function seedAccount(dataSource: DataSource, label: string): Promise<string> {
	const one = async (sql: string, params: unknown[]): Promise<string> =>
		((await dataSource.query(sql, params)) as Array<{id: string}>)[0].id;

	const accountId = await one(
		`INSERT INTO "accounts" ("name", "email", "password") VALUES ($1, $2, 'not-a-real-hash') RETURNING "id"`,
		[`Example ${label}`, `${label}@example.test`],
	);
	await dataSource.query(
		`INSERT INTO "personal_access_tokens" ("accountId", "name", "tokenHash", "prefix") VALUES ($1, 'Example token', $2, 'tmp_test')`,
		[accountId, `${label}-token-hash`],
	);
	const connectionId = await one(
		`INSERT INTO "bank_connections" ("accountId", "aspspName", "aspspCountry", "providerSessionId") VALUES ($1, 'Example Bank', 'NL', $2) RETURNING "id"`,
		[accountId, `${label}-session`],
	);
	const bankAccountId = await one(
		`INSERT INTO "bank_accounts" ("bankConnectionId", "providerAccountId", "identificationHash", "currency", "iban") VALUES ($1, $2, $3, 'EUR', 'NL91ABNA0417164300') RETURNING "id"`,
		[connectionId, `${label}-account`, `${label}-identification`],
	);
	const syncRunId = await one(`INSERT INTO "bank_sync_runs" ("bankConnectionId") VALUES ($1) RETURNING "id"`, [
		connectionId,
	]);
	await dataSource.query(
		`INSERT INTO "bank_account_balances" ("bankAccountId", "bankSyncRunId", "balanceType", "amount", "currency") VALUES ($1, $2, 'CLBD', 10, 'EUR')`,
		[bankAccountId, syncRunId],
	);
	const importId = await one(
		`INSERT INTO "bank_imports" ("accountId", "bankConnectionId", "fileHash", "format", "filesCount", "rowsParsed", "rowsAdded", "rowsAlreadyPresent", "bankAccountIds", "createdBankAccountIds")
		VALUES ($1, $2, $3, 'csv', 1, 1, 1, 0, ARRAY[$4::uuid], '{}') RETURNING "id"`,
		[accountId, connectionId, `${label}-file-hash`, bankAccountId],
	);
	const transaction = (key: string) =>
		one(
			`INSERT INTO "bank_transactions" ("bankAccountId", "stableIdentityKey", "stableIdentityGroupKey", "bookingDate", "amount", "currency", "creditDebitIndicator", "displayDescription", "merchantKey", "importId")
			VALUES ($1, $2, $3, '2026-01-05', 12.5, 'EUR', 'DBIT', 'Example Shop', 'example shop', $4) RETURNING "id"`,
			[bankAccountId, `${label}-${key}`, `${label}-${key}-group`, importId],
		);
	const transactionId = await transaction('first');
	const counterpartId = await transaction('second');
	await dataSource.query(`UPDATE "bank_transactions" SET "ownTransferCounterpartId" = $2 WHERE "id" = $1`, [
		transactionId,
		counterpartId,
	]);
	await dataSource.query(
		`INSERT INTO "bank_import_doubtful_rows" ("importId", "bankAccountId", "row", "candidateTransactionIds", "importedTransactionId") VALUES ($1, $2, '{}', ARRAY[$3::uuid], $3)`,
		[importId, bankAccountId, transactionId],
	);
	await dataSource.query(
		`INSERT INTO "bank_import_layouts" ("accountId", "layout", "bankName") VALUES ($1, '{}', 'Example Bank')`,
		[accountId],
	);
	await dataSource.query(
		`INSERT INTO "bank_import_layout_proposals" ("accountId", "fileHash", "status", "expiresAt") VALUES ($1, $2, 'ready', NOW() + interval '1 day')`,
		[accountId, `${label}-proposal-hash`],
	);
	await dataSource.query(
		`INSERT INTO "bank_import_layout_misses" ("accountId", "bankId", "outcome") VALUES ($1, 'ing-nl', 'mapper')`,
		[accountId],
	);
	await dataSource.query(
		`INSERT INTO "bank_requests" ("accountId", "bankName", "country", "fileTypes") VALUES ($1, 'Example Bank', 'DE', '["csv"]')`,
		[accountId],
	);
	const ownLogoId = await one(`INSERT INTO "merchant_logos" ("domain") VALUES ($1) RETURNING "id"`, [
		`${label}-shop.example`,
	]);
	const sharedLogoId = await one(`SELECT "id" FROM "merchant_logos" WHERE "domain" = 'shared-shop.example'`, []);
	await dataSource.query(
		`INSERT INTO "merchants" ("accountId", "key", "domain", "logoId") VALUES ($1, 'example shop', $2, $3), ($1, 'shared shop', 'shared-shop.example', $4)`,
		[accountId, `${label}-shop.example`, ownLogoId, sharedLogoId],
	);
	await dataSource.query(
		`INSERT INTO "recurring_continuation_unlinks" ("accountId", "olderTransactionIds", "newerTransactionIds") VALUES ($1, ARRAY[$2::uuid], ARRAY[$3::uuid])`,
		[accountId, transactionId, counterpartId],
	);
	await dataSource.query(
		`INSERT INTO "recurring_series_hides" ("accountId", "seriesKey", "transactionIds") VALUES ($1, 'example-series', ARRAY[$2::uuid])`,
		[accountId, transactionId],
	);
	await dataSource.query(
		`INSERT INTO "recurring_snapshots" ("accountId", "inputVersion", "rulesVersion", "payload") VALUES ($1, 'v1', 'v1', '{}')`,
		[accountId],
	);
	await dataSource.query(`INSERT INTO "push_preferences" ("accountId") VALUES ($1)`, [accountId]);
	await dataSource.query(
		`INSERT INTO "push_subscriptions" ("accountId", "endpoint", "p256dh", "auth", "sessionId") VALUES ($1, $2, 'example-key', 'example-auth', $3)`,
		[accountId, `https://push.example.test/${label}`, `${label}-session`],
	);
	return accountId;
}
