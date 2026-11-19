import {DataSource} from 'typeorm';

import {installSchemaExtras} from '@core/database/synchronized-schema-extras';

import {getApp} from '../../setup/e2e.setup';

const FRESH_DATABASE = 'tempo_fresh_install';

describe('Fresh database install', () => {
	let fresh: DataSource;

	beforeAll(async () => {
		const testDataSource = getApp().get(DataSource);
		await testDataSource.query(`DROP DATABASE IF EXISTS "${FRESH_DATABASE}"`);
		await testDataSource.query(`CREATE DATABASE "${FRESH_DATABASE}"`);
		fresh = new DataSource({
			...testDataSource.options,
			database: FRESH_DATABASE,
			synchronize: false,
			dropSchema: false,
			migrationsRun: false,
			migrations: testDataSource.migrations.map(
				(migration) => migration.constructor as new () => typeof migration,
			),
		} as typeof testDataSource.options);
		await fresh.initialize();
	});

	afterAll(async () => {
		await fresh?.destroy();
		await getApp().get(DataSource).query(`DROP DATABASE IF EXISTS "${FRESH_DATABASE}"`);
	});

	it('records every migration on an empty database, then gets its schema from the schema script', async () => {
		const applied = await fresh.runMigrations({transaction: 'each'});
		expect(applied).toHaveLength(fresh.migrations.length);
		expect(applied.length).toBeGreaterThan(0);

		await fresh.synchronize();
		await installSchemaExtras(fresh);
		const tables = (await fresh.query(
			`SELECT "tablename" FROM pg_tables WHERE "schemaname" = 'public' AND "tablename" IN ('accounts', 'bank_transactions', 'bank_history_changes')`,
		)) as Array<{tablename: string}>;
		expect(tables.map(({tablename}) => tablename).sort()).toEqual([
			'accounts',
			'bank_history_changes',
			'bank_transactions',
		]);

		expect(await fresh.runMigrations({transaction: 'each'})).toEqual([]);
	});
});
