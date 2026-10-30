import {NestFactory} from '@nestjs/core';
import {AppModule} from 'src/app.module';
import {DataSource, QueryRunner} from 'typeorm';

import {seedAccounts} from './seed-data/seed-accounts';
import {seedBankingData} from './seed-data/seed-banking-data';
import {seedOwnTransferData} from './seed-data/seed-own-transfer-data';

seed();

async function seed() {
	await truncate();
	const app = await bootstrap();

	console.log('Seeding database...');
	await seedAccounts(app);
	await seedBankingData(app);
	await seedOwnTransferData(app);

	console.log('Seeding complete.');
	await app.close();
	process.exit(0);
}

async function bootstrap() {
	const app = await NestFactory.createApplicationContext(AppModule, {logger: ['error', 'warn']});
	const dataSource = app.get(DataSource);
	await dataSource.synchronize();
	return app;
}

async function truncate() {
	let queryRunner: QueryRunner | undefined = undefined;

	const dataSource = new DataSource({
		type: 'postgres',
		host: process.env.DB_HOST,
		port: parseInt(process.env.DB_PORT!),
		username: process.env.DB_USERNAME,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
		logging: ['error', 'warn'],
		synchronize: false,
	});

	try {
		await dataSource.initialize();
		console.log('Recreating schema...');

		queryRunner = dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.query('DROP SCHEMA public CASCADE;');
		await queryRunner.query('CREATE SCHEMA public;');
		await queryRunner.release();

		console.log('Public schema recreated.');
	} finally {
		if (queryRunner) queryRunner.release();
		if (dataSource.isInitialized) await dataSource.destroy();
	}
}
