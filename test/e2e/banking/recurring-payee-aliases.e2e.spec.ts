import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {importRecurringPayeeAliases} from '@modules/banking/recurring/recurring-payee-alias-import';
import {RecurringPayeeAlias} from '@modules/banking/recurring/recurring-payee-alias.entity';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';

describe('Recurring payee aliases', () => {
	const sourceKey = 'EXPENSE:example media';
	let owner: Account;
	let otherOwner: Account;
	let database: DataSource;
	let sourceBankAccountId: string;

	function runCli(input: unknown, extraArgs: string[] = [], overrides: NodeJS.ProcessEnv = {}) {
		const directory = mkdtempSync(join(tmpdir(), 'recurring-aliases-'));
		const file = join(directory, 'aliases.json');
		writeFileSync(file, JSON.stringify(input), {mode: 0o600});
		const config = database.options;
		if (config.type !== 'postgres') throw new Error('Test requires PostgreSQL');
		try {
			return spawnSync(
				process.execPath,
				[
					'-r',
					'ts-node/register/transpile-only',
					'-r',
					'tsconfig-paths/register',
					'src/scripts/set-recurring-payee-aliases.ts',
					'--owner-id',
					owner.id,
					'--input',
					file,
					...extraArgs,
				],
				{
					encoding: 'utf8',
					timeout: 15000,
					env: {
						...process.env,
						DB_HOST: config.host,
						DB_PORT: String(config.port),
						DB_USERNAME: config.username,
						DB_PASSWORD: String(config.password),
						DB_NAME: config.database,
						...overrides,
					},
				},
			);
		} finally {
			rmSync(directory, {recursive: true, force: true});
		}
	}

	beforeAll(async () => {
		database = getApp().get(DataSource);
		const accounts = database.getRepository(Account);
		owner = await accounts.save(
			accounts.create({
				name: 'Example Owner',
				email: `aliases-${randomUUID()}@example.com`,
				password: 'unused-test-password',
			}),
		);
		otherOwner = await accounts.save(
			accounts.create({
				name: 'Example Other Owner',
				email: `aliases-${randomUUID()}@example.com`,
				password: 'unused-test-password',
			}),
		);
		const fixtures = new BankingFixtures(getApp());
		const bankAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner));
		sourceBankAccountId = bankAccount.id;
		await fixtures.createTransaction(
			bankAccount,
			bookedRow('2026-06-05', '-14.00', {
				counterpartyName: 'Example Media',
				merchantKey: sourceKey,
				category: 'SUBSCRIPTIONS',
			}),
		);
		await fixtures.createTransaction(
			bankAccount,
			bookedRow('2026-06-06', '-24.00', {
				counterpartyName: 'Example Media',
				merchantKey: sourceKey,
				category: 'HOUSING_AND_UTILITIES',
			}),
		);
		await fixtures.createTransactions(bankAccount, [
			bookedRow('2026-06-07', '-14.00', {merchantKey: 'EXPENSE:example legacy media', category: 'SUBSCRIPTIONS'}),
			bookedRow('2026-06-07', '14.00', {merchantKey: 'INCOME:example media', category: 'SUBSCRIPTIONS'}),
			bookedRow('2026-06-07', '14.00', {
				merchantKey: 'EXPENSE:example wrong direction',
				category: 'SUBSCRIPTIONS',
			}),
			bookedRow('2026-06-07', '-14.00', {
				merchantKey: 'UNKNOWN:example media',
				creditDebitIndicator: null,
				category: 'SUBSCRIPTIONS',
			}),
		]);
		const otherBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(otherOwner));
		await fixtures.createTransaction(
			otherBankAccount,
			bookedRow('2026-06-06', '-12.00', {
				counterpartyName: 'Example Other Owner',
				merchantKey: 'EXPENSE:example other owner',
				category: 'SUBSCRIPTIONS',
			}),
		);
	});

	beforeEach(async () => {
		await database.getRepository(RecurringPayeeAlias).delete({accountId: owner.id});
	});

	afterAll(async () => {
		if (owner) await database.getRepository(Account).delete(owner.id);
		if (otherOwner) await database.getRepository(Account).delete(otherOwner.id);
	});

	it.each([false, true])('requires owner-scoped source evidence before importing (apply=%s)', async (apply) => {
		const valid = {merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId: randomUUID()};
		for (const missing of [
			{...valid, merchantKey: 'EXPENSE:example missing'},
			{...valid, category: 'HEALTH'},
			{...valid, merchantKey: 'EXPENSE:example other owner'},
		]) {
			await expect(
				importRecurringPayeeAliases(database, owner.id, {aliases: [valid, missing]}, {apply}),
			).rejects.toMatchObject({code: 'source_missing'});
			expect(await database.getRepository(RecurringPayeeAlias).countBy({accountId: owner.id})).toBe(0);
		}
		await expect(importRecurringPayeeAliases(database, randomUUID(), {aliases: []}, {apply})).rejects.toMatchObject(
			{code: 'owner_not_found'},
		);
	});

	it.each(['EXPENSE:example wrong direction', 'UNKNOWN:example media'])(
		'rejects unproven source direction for %s',
		async (merchantKey) => {
			await expect(
				importRecurringPayeeAliases(
					database,
					owner.id,
					{
						aliases: [
							{
								merchantKey,
								category: 'SUBSCRIPTIONS',
								payeeGroupId: randomUUID(),
							},
						],
					},
					{apply: true},
				),
			).rejects.toMatchObject({code: 'group_direction_mismatch'});
			expect(await database.getRepository(RecurringPayeeAlias).countBy({accountId: owner.id})).toBe(0);
		},
	);

	it.each([
		['purpose', {merchantKey: sourceKey, category: 'HOUSING_AND_UTILITIES'}, 'group_purpose_mismatch'],
		['direction', {merchantKey: 'INCOME:example media', category: 'SUBSCRIPTIONS'}, 'group_direction_mismatch'],
	])('rejects mixed %s in incoming or existing groups', async (_label, second, code) => {
		for (const persisted of [false, true]) {
			for (const apply of [false, true]) {
				const payeeGroupId = randomUUID();
				const first = {merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId};
				if (persisted) await importRecurringPayeeAliases(database, owner.id, {aliases: [first]}, {apply: true});
				const before = await database.getRepository(RecurringPayeeAlias).findBy({accountId: owner.id});
				await expect(
					importRecurringPayeeAliases(
						database,
						owner.id,
						{
							aliases: [...(persisted ? [] : [first]), {...second, payeeGroupId}],
						},
						{apply},
					),
				).rejects.toMatchObject({code});
				expect(await database.getRepository(RecurringPayeeAlias).findBy({accountId: owner.id})).toEqual(before);
				await database.getRepository(RecurringPayeeAlias).delete({accountId: owner.id});
			}
		}
	});

	it.each([
		['missing manifest', null],
		['missing aliases', {}],
		['non-array aliases', {aliases: 'invalid'}],
		['unexpected manifest property', {aliases: [], owner: 'ignored'}],
		[
			'invalid group UUID',
			{aliases: [{merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId: 'bad-id'}]},
		],
		['null category', {aliases: [{merchantKey: sourceKey, category: null, payeeGroupId: randomUUID()}]}],
		['unknown category', {aliases: [{merchantKey: sourceKey, category: 'UNKNOWN', payeeGroupId: randomUUID()}]}],
		['blank merchant key', {aliases: [{merchantKey: ' ', category: 'SUBSCRIPTIONS', payeeGroupId: randomUUID()}]}],
		[
			'unexpected alias property',
			{
				aliases: [
					{
						merchantKey: sourceKey,
						category: 'SUBSCRIPTIONS',
						payeeGroupId: randomUUID(),
						direction: 'EXPENSE',
					},
				],
			},
		],
		[
			'duplicate scoped key',
			{
				aliases: [
					{merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId: randomUUID()},
					{merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId: randomUUID()},
				],
			},
		],
	])('rejects %s without applying any rows', async (_label, input) => {
		await expect(importRecurringPayeeAliases(database, owner.id, input, {apply: true})).rejects.toMatchObject({
			code: 'invalid_input',
			message: 'Recurring payee alias import rejected: invalid_input',
		});
		expect(await database.getRepository(RecurringPayeeAlias).countBy({accountId: owner.id})).toBe(0);
	});

	it('rejects malformed owner UUIDs', async () => {
		await expect(
			importRecurringPayeeAliases(database, 'not-a-uuid', {aliases: []}, {apply: true}),
		).rejects.toMatchObject({code: 'invalid_input'});
	});

	it('validates a private manifest without writing by default', async () => {
		expect(
			await importRecurringPayeeAliases(database, owner.id, {
				aliases: [
					{
						merchantKey: sourceKey,
						category: 'SUBSCRIPTIONS',
						payeeGroupId: randomUUID(),
					},
				],
			}),
		).toEqual({dryRun: true, requested: 1, wouldInsert: 1, inserted: 0, unchanged: 0});
		expect(await database.getRepository(RecurringPayeeAlias).countBy({accountId: owner.id})).toBe(0);
	});
	it('applies aliases idempotently without rewriting timestamps or source rows', async () => {
		const input = {aliases: [{merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId: randomUUID()}]};
		const before = await database.query('SELECT * FROM bank_transactions ORDER BY id');
		const result = await importRecurringPayeeAliases(database, owner.id, input, {apply: true});
		expect(result).toEqual({dryRun: false, requested: 1, wouldInsert: 1, inserted: 1, unchanged: 0});
		const repository = database.getRepository(RecurringPayeeAlias);
		const rows = await repository.findBy({accountId: owner.id});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({accountId: owner.id, ...input.aliases[0]});
		expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
		const rerun = await importRecurringPayeeAliases(database, owner.id, input, {apply: true});
		expect(rerun).toEqual({dryRun: false, requested: 1, wouldInsert: 0, inserted: 0, unchanged: 1});
		expect(await repository.findBy({accountId: owner.id})).toEqual(rows);
		expect(await database.query('SELECT * FROM bank_transactions ORDER BY id')).toEqual(before);
		await repository.delete({accountId: owner.id});
	});

	it.each([false, true])('rejects conflicting reassignment atomically (apply=%s)', async (apply) => {
		const first = {merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId: randomUUID()};
		await importRecurringPayeeAliases(database, owner.id, {aliases: [first]}, {apply: true});
		const before = await database.getRepository(RecurringPayeeAlias).findBy({accountId: owner.id});
		await expect(
			importRecurringPayeeAliases(
				database,
				owner.id,
				{
					aliases: [
						{...first, merchantKey: 'EXPENSE:example legacy media', payeeGroupId: randomUUID()},
						{...first, payeeGroupId: randomUUID()},
					],
				},
				{apply},
			),
		).rejects.toMatchObject({code: 'alias_conflict'});
		expect(await database.getRepository(RecurringPayeeAlias).findBy({accountId: owner.id})).toEqual(before);
	});

	it('serializes concurrent assignments without overwriting the winning identity', async () => {
		const inputs = [randomUUID(), randomUUID()].map((payeeGroupId) => ({
			aliases: [
				{
					merchantKey: sourceKey,
					category: 'SUBSCRIPTIONS',
					payeeGroupId,
				},
			],
		}));
		const results = await Promise.allSettled(
			inputs.map((input) => importRecurringPayeeAliases(database, owner.id, input, {apply: true})),
		);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toEqual([
			expect.objectContaining({reason: expect.objectContaining({code: 'alias_conflict'})}),
		]);
		expect(await database.getRepository(RecurringPayeeAlias).countBy({accountId: owner.id})).toBe(1);
	});

	it('rolls back the whole import when PostgreSQL rejects a later row without exposing row data', async () => {
		await database.query(`CREATE FUNCTION recurring_alias_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				IF NEW."merchantKey" = 'EXPENSE:example legacy media' THEN
					RAISE EXCEPTION 'synthetic private marker: %', NEW."merchantKey";
				END IF;
				RETURN NEW;
			END;
		$$`);
		await database.query(`CREATE TRIGGER recurring_alias_test_failure BEFORE INSERT ON recurring_payee_aliases
			FOR EACH ROW EXECUTE FUNCTION recurring_alias_test_failure()`);
		try {
			const payeeGroupId = randomUUID();
			await expect(
				importRecurringPayeeAliases(
					database,
					owner.id,
					{
						aliases: [
							{merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId},
							{merchantKey: 'EXPENSE:example legacy media', category: 'SUBSCRIPTIONS', payeeGroupId},
						],
					},
					{apply: true},
				),
			).rejects.toMatchObject({
				code: 'import_failed',
				message: 'Recurring payee alias import rejected: import_failed',
			});
			expect(await database.getRepository(RecurringPayeeAlias).countBy({accountId: owner.id})).toBe(0);
		} finally {
			await database.query('DROP TRIGGER recurring_alias_test_failure ON recurring_payee_aliases');
			await database.query('DROP FUNCTION recurring_alias_test_failure()');
		}
	});

	it('registers the owner-scoped alias schema in the application', async () => {
		const database = getApp().get(DataSource);
		const [schema] = (await database.query(
			`SELECT EXISTS (
				SELECT 1 FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name = 'recurring_payee_aliases'
			) AS present`,
		)) as {present: boolean}[];

		expect(schema.present).toBe(true);
	});

	it('keeps exact merchant text and separates category-scoped identities', async () => {
		const merchantKey = "EXPENSE:Example Media ' ; --  ";
		const fixtures = new BankingFixtures(getApp());
		const source = await fixtures.createTransaction(
			{id: sourceBankAccountId},
			bookedRow('2026-06-08', '-14.00', {
				merchantKey,
				category: 'SUBSCRIPTIONS',
			}),
		);
		const sourceBefore = await fixtures.transactions.findOneByOrFail({id: source.id});
		try {
			const payeeGroupId = randomUUID();
			const input = {
				aliases: [
					{merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId},
					{merchantKey: 'EXPENSE:example legacy media', category: 'SUBSCRIPTIONS', payeeGroupId},
					{merchantKey: sourceKey, category: 'HOUSING_AND_UTILITIES', payeeGroupId: randomUUID()},
					{merchantKey, category: 'SUBSCRIPTIONS', payeeGroupId},
				],
			};
			expect(await importRecurringPayeeAliases(database, owner.id, input, {apply: true})).toMatchObject({
				inserted: 4,
			});
			const rows = await database.getRepository(RecurringPayeeAlias).findBy({accountId: owner.id});
			expect(rows).toHaveLength(4);
			for (const alias of input.aliases) expect(rows).toContainEqual(expect.objectContaining(alias));
			expect(await fixtures.transactions.findOneByOrFail({id: source.id})).toEqual(sourceBefore);
		} finally {
			await fixtures.transactions.delete(source.id);
		}
	});

	it('enforces owner foreign keys, scoped uniqueness and owner deletion cascades', async () => {
		const accounts = database.getRepository(Account);
		const temporaryOwner = await accounts.save(
			accounts.create({
				name: 'Example Temporary Owner',
				email: `aliases-${randomUUID()}@example.com`,
				password: 'unused-test-password',
			}),
		);
		const repository = database.getRepository(RecurringPayeeAlias);
		const alias = {merchantKey: sourceKey, category: 'SUBSCRIPTIONS' as const, payeeGroupId: randomUUID()};
		try {
			await repository.save(repository.create({...alias, accountId: temporaryOwner.id}));
			await repository.save(repository.create({...alias, accountId: owner.id}));
			await repository.save(
				repository.create({...alias, category: 'HOUSING_AND_UTILITIES', accountId: owner.id}),
			);
			await expect(repository.insert({...alias, accountId: owner.id})).rejects.toMatchObject({code: '23505'});
			await expect(repository.insert({...alias, accountId: randomUUID()})).rejects.toMatchObject({code: '23503'});
		} finally {
			await accounts.delete(temporaryOwner.id);
		}
		expect(await repository.countBy({accountId: temporaryOwner.id})).toBe(0);
		expect(await repository.countBy({accountId: owner.id})).toBe(2);
	});

	it.each([
		{
			args: ['--apply'],
			env: {},
			input: {
				aliases: [
					{merchantKey: 'EXPENSE:example missing', category: 'SUBSCRIPTIONS', payeeGroupId: randomUUID()},
				],
			},
		},
		{args: [], env: {DB_PASSWORD: 'synthetic-wrong-password'}, input: {aliases: []}},
		{args: [], env: {DB_HOST: undefined}, input: {aliases: []}},
		{args: ['--owner-id', 'synthetic-private-argument'], env: {}, input: {aliases: []}},
	])(
		'prints only an aggregate failure for private CLI errors %#',
		async ({args, env, input}) => {
			const result = runCli(input, args, env);
			expect(result.status).toBe(1);
			expect(result.stdout).toBe('');
			expect(result.stderr).toBe('{"failed":1}\n');
			expect(await database.getRepository(RecurringPayeeAlias).countBy({accountId: owner.id})).toBe(0);
		},
		20000,
	);

	it('runs the private CLI as a narrow dry-run, apply and idempotent rerun', async () => {
		const input = {aliases: [{merchantKey: sourceKey, category: 'SUBSCRIPTIONS', payeeGroupId: randomUUID()}]};
		const preview = runCli(input);
		expect(preview.status).toBe(0);
		expect(preview.stderr).toBe('');
		expect(JSON.parse(preview.stdout) as unknown).toEqual({
			dryRun: true,
			requested: 1,
			wouldInsert: 1,
			inserted: 0,
			unchanged: 0,
		});
		expect(await database.getRepository(RecurringPayeeAlias).countBy({accountId: owner.id})).toBe(0);
		const applied = runCli(input, ['--apply']);
		expect(applied.status).toBe(0);
		expect(applied.stderr).toBe('');
		expect(JSON.parse(applied.stdout) as unknown).toEqual({
			dryRun: false,
			requested: 1,
			wouldInsert: 1,
			inserted: 1,
			unchanged: 0,
		});
		const before = await database.getRepository(RecurringPayeeAlias).findBy({accountId: owner.id});
		const repeated = runCli(input, ['--apply']);
		expect(repeated.status).toBe(0);
		expect(JSON.parse(repeated.stdout) as unknown).toEqual({
			dryRun: false,
			requested: 1,
			wouldInsert: 0,
			inserted: 0,
			unchanged: 1,
		});
		expect(await database.getRepository(RecurringPayeeAlias).findBy({accountId: owner.id})).toEqual(before);
	}, 20000);

	it('enforces known non-null categories in the synchronized schema', async () => {
		for (const category of ['UNKNOWN', null]) {
			await expect(
				database.query(
					`INSERT INTO recurring_payee_aliases ("accountId", "merchantKey", category, "payeeGroupId")
				VALUES ($1, $2, $3, $4)`,
					[owner.id, sourceKey, category, randomUUID()],
				),
			).rejects.toMatchObject({code: category === null ? '23502' : '23514'});
		}
	});

	it('adds the alias table with an additive, reversible migration', async () => {
		const database = getApp().get(DataSource);
		const migration = database.migrations.find((entry) => entry.name === 'AddRecurringPayeeAliases20261019120000');
		expect(migration).toBeDefined();
		const runner = database.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			const accountsBefore = await runner.query('SELECT * FROM accounts ORDER BY id');
			const transactionsBefore = await runner.query('SELECT * FROM bank_transactions ORDER BY id');
			await runner.dropTable('recurring_payee_aliases');
			await migration!.up(runner);
			await migration!.up(runner);
			const table = await runner.getTable('recurring_payee_aliases');
			expect(table?.columns.every((column) => !column.isNullable)).toBe(true);
			expect(table?.checks.map((check) => check.name)).toContain('chk_recurring_payee_aliases_category');
			expect(table?.columns.map((column) => column.name)).toEqual([
				'id',
				'accountId',
				'merchantKey',
				'category',
				'payeeGroupId',
				'createdAt',
				'updatedAt',
			]);
			expect(table?.uniques.map((unique) => unique.columnNames)).toContainEqual([
				'accountId',
				'merchantKey',
				'category',
			]);
			expect(table?.foreignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({referencedTableName: 'accounts', onDelete: 'CASCADE'}),
				]),
			);
			const repository = runner.manager.getRepository(RecurringPayeeAlias);
			const alias = await repository.save(
				repository.create({
					accountId: owner.id,
					merchantKey: sourceKey,
					category: 'SUBSCRIPTIONS',
					payeeGroupId: randomUUID(),
				}),
			);
			expect(alias.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(alias.createdAt).toBeInstanceOf(Date);
			expect(alias.updatedAt).toBeInstanceOf(Date);
			expect(await repository.findOneByOrFail({id: alias.id})).toEqual(alias);
			expect(await runner.query('SELECT * FROM accounts ORDER BY id')).toEqual(accountsBefore);
			expect(await runner.query('SELECT * FROM bank_transactions ORDER BY id')).toEqual(transactionsBefore);
			await migration!.down(runner);
			expect(await runner.hasTable('recurring_payee_aliases')).toBe(false);
			await migration!.up(runner);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
		}
	});
});
