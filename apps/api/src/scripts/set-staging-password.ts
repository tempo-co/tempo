import argon2 from 'argon2';
import {DataSource} from 'typeorm';

import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_NAME} from '../../scripts/seed-data/seed.constants';

const REFRESH_DATABASE = 'tempo_staging_refresh';

export function assertStagingDatabaseTarget(databaseName: string | undefined, host: string | undefined): void {
	if (databaseName !== REFRESH_DATABASE || host !== 'postgres') {
		throw new Error('staging password reset may only use the local staging refresh database host and name');
	}
}

export async function resetSingleStagingAccountPassword(queryable: Pick<DataSource, 'query'>, password: string) {
	const passwordLength = Buffer.byteLength(password, 'utf8');
	if (passwordLength < 16 || passwordLength > 255) {
		throw new Error('staging password must be between 16 and 255 UTF-8 bytes');
	}

	const accounts = (await queryable.query('SELECT id FROM accounts')) as Array<{id: string}>;
	if (accounts.length !== 1) throw new Error('expected exactly one staging account');

	const passwordHash = await argon2.hash(password);
	const [updated, affectedRows] = (await queryable.query(
		'UPDATE accounts SET password = $1, name = $2, email = $3, "updatedAt" = NOW() WHERE id = $4 RETURNING id',
		[passwordHash, VERIFIED_ACCOUNT_NAME, VERIFIED_ACCOUNT_EMAIL, accounts[0].id],
	)) as [Array<{id: string}>, number];
	if (updated.length !== 1 || affectedRows !== 1) {
		throw new Error('password update did not affect exactly one staging account');
	}
}

async function readStagingPassword() {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (size > 256) throw new Error('staging password input is too large');
		chunks.push(bytes);
	}

	let bytes = Buffer.concat(chunks);
	if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0a) {
		bytes = bytes.subarray(0, bytes.length - 1);
		if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0d) bytes = bytes.subarray(0, bytes.length - 1);
	}
	const password = bytes.toString('utf8');
	if (password.includes('\n') || password.includes('\r')) throw new Error('staging password input must be one line');
	const passwordLength = Buffer.byteLength(password, 'utf8');
	if (passwordLength < 16 || passwordLength > 255) {
		throw new Error('staging password must be between 16 and 255 UTF-8 bytes');
	}
	return password;
}

async function main() {
	const {DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD} = process.env;
	assertStagingDatabaseTarget(process.env.DB_NAME, DB_HOST);
	const port = Number(DB_PORT);
	if (!DB_HOST || !Number.isInteger(port) || port < 1 || port > 65535 || !DB_USERNAME || !DB_PASSWORD) {
		throw new Error('staging database configuration is incomplete');
	}

	const password = await readStagingPassword();
	const dataSource = new DataSource({
		type: 'postgres',
		host: DB_HOST,
		port,
		username: DB_USERNAME,
		password: DB_PASSWORD,
		database: REFRESH_DATABASE,
		synchronize: false,
		migrationsRun: false,
		extra: {max: 1},
	});
	await dataSource.initialize();
	try {
		await resetSingleStagingAccountPassword(dataSource, password);
	} finally {
		await dataSource.destroy();
	}
	process.stdout.write('Staging account password updated.\n');
}

if (require.main === module) {
	main().catch(() => {
		process.stderr.write('Staging account password reset failed.\n');
		process.exitCode = 1;
	});
}
