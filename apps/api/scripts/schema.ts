import {NestFactory} from '@nestjs/core';
import {DataSource} from 'typeorm';

import {AppModule} from '../src/app.module';

/**
 * Creates the database schema from the current entities without inserting data.
 *
 * Production runs migrations only (`synchronize: false`), and the migration set
 * contains no baseline, so a fresh production database has no tables until this
 * script runs. Existing databases are brought up to date with the current
 * entities, so it is also the migration complement for schema changes that have
 * no migration yet.
 *
 * Run inside the API container (or anywhere the config env is loaded):
 *
 *   node dist/scripts/schema.js
 */
schema();

async function schema() {
	const app = await NestFactory.createApplicationContext(AppModule, {logger: ['error', 'warn']});
	const dataSource = app.get(DataSource);

	console.log('Synchronizing database schema...');
	await dataSource.synchronize();
	console.log('Schema synchronized.');

	await app.close();
	process.exit(0);
}
