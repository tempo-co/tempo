import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {DataSource} from 'typeorm';
import {z} from 'zod';

import {
	RecurringPayeeAliasImportError,
	RecurringPayeeAliasImportResult,
	importRecurringPayeeAliases,
} from '@modules/banking/recurring/recurring-payee-alias-import';

const databaseSchema = z.object({
	DB_HOST: z.string().min(1),
	DB_PORT: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)),
	DB_USERNAME: z.string().min(1),
	DB_PASSWORD: z.string().min(1),
	DB_NAME: z.string().min(1),
});

function parseCliArguments(args: readonly string[]) {
	try {
		const {values, tokens} = parseArgs({
			args: [...args],
			allowPositionals: false,
			strict: true,
			tokens: true,
			options: {'owner-id': {type: 'string'}, input: {type: 'string'}, apply: {type: 'boolean', default: false}},
		});
		const names = tokens.filter((token) => token.kind === 'option').map((token) => token.name);
		if (new Set(names).size !== names.length) throw new RecurringPayeeAliasImportError('invalid_arguments');
		return {
			owner: z.uuid().parse(values['owner-id']),
			file: z.string().min(1).parse(values.input),
			apply: values.apply,
		};
	} catch {
		throw new RecurringPayeeAliasImportError('invalid_arguments');
	}
}

/**
 * Private JSON: {aliases: [{merchantKey, category, payeeGroupId}]}.
 * Run with explicit DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD and DB_NAME environment variables:
 * ts-node -r tsconfig-paths/register src/scripts/set-recurring-payee-aliases.ts --owner-id <uuid> --input <private-json> [--apply]
 * Does not load application env files or start Nest, queues, synchronization or migrations.
 */
export async function runRecurringPayeeAliasImportCli(
	args: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): Promise<RecurringPayeeAliasImportResult> {
	const {owner, file, apply} = parseCliArguments(args);
	const parsedConfig = databaseSchema.safeParse(env);
	if (!parsedConfig.success) throw new RecurringPayeeAliasImportError('invalid_database_config');
	const config = parsedConfig.data;
	const input: unknown = JSON.parse(await readFile(file, 'utf8'));
	const database = new DataSource({
		type: 'postgres',
		host: config.DB_HOST,
		port: config.DB_PORT,
		username: config.DB_USERNAME,
		password: config.DB_PASSWORD,
		database: config.DB_NAME,
		entities: [],
		synchronize: false,
		migrationsRun: false,
		dropSchema: false,
		logging: false,
		applicationName: 'recurring-payee-alias-import',
	});
	try {
		await database.initialize();
		return await importRecurringPayeeAliases(database, owner, input, {apply});
	} finally {
		if (database.isInitialized) await database.destroy();
	}
}

if (require.main === module) {
	void runRecurringPayeeAliasImportCli(process.argv.slice(2)).then(
		(result) => process.stdout.write(`${JSON.stringify(result)}\n`),
		() => {
			process.stderr.write('{"failed":1}\n');
			process.exitCode = 1;
		},
	);
}
