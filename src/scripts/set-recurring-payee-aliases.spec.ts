import {randomUUID} from 'node:crypto';

import {runRecurringPayeeAliasImportCli} from './set-recurring-payee-aliases';

describe('Recurring payee alias CLI', () => {
	const owner = randomUUID();
	const base = ['--owner-id', owner, '--input', 'private-aliases.json'];

	const database = {
		DB_HOST: '127.0.0.1',
		DB_PORT: '1',
		DB_USERNAME: 'example',
		DB_PASSWORD: 'synthetic-password',
		DB_NAME: 'example',
	};

	it.each(Object.keys(database))(
		'requires explicit %s rather than falling back to application configuration',
		async (key) => {
			await expect(runRecurringPayeeAliasImportCli(base, {...database, [key]: undefined})).rejects.toMatchObject({
				code: 'invalid_database_config',
				message: 'Recurring payee alias import rejected: invalid_database_config',
			});
		},
	);

	it.each(['0', '65536', '42x', ''])('rejects invalid explicit database ports (%s)', async (port) => {
		await expect(runRecurringPayeeAliasImportCli(base, {...database, DB_PORT: port})).rejects.toMatchObject({
			code: 'invalid_database_config',
		});
	});

	it.each(
		[
			[],
			['--owner-id', owner],
			['--input', 'private-aliases.json'],
			['--owner-id', 'bad-owner', '--input', 'private-aliases.json'],
			[...base, '--owner-id', owner],
			[...base, '--input=another-private-file.json'],
			[...base, '--apply', '--apply'],
			[...base, '--unknown'],
			[...base, 'unexpected-positional'],
		].map((args) => ({args})),
	)('rejects ambiguous or malformed arguments without exposing their values ($args)', async ({args}) => {
		await expect(runRecurringPayeeAliasImportCli(args, {})).rejects.toMatchObject({
			code: 'invalid_arguments',
			message: 'Recurring payee alias import rejected: invalid_arguments',
		});
	});
});
