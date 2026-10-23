import Redis from 'ioredis';
import {createHash} from 'node:crypto';
import request from 'supertest';
import {DataSource} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {PersonalAccessToken} from '@core/personal-access-token/personal-access-token.entity';
import {REDIS} from '@core/redis/redis.constants';
import {Account} from '@modules/account/account.entity';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

const PATH = '/personal-access-tokens';
const ORIGIN = 'http://localhost:5173';

describe('Personal access tokens', () => {
	it('installs an additive idempotent migration with a cascading owner foreign key', async () => {
		const ds = getApp().get(DataSource);
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			await runner.query('DROP TABLE personal_access_tokens');
			const snapshot = async () => {
				const tables: Array<{tablename: string}> = await runner.query(
					"SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'personal_access_tokens' ORDER BY tablename",
				);
				const rows = [];
				for (const {tablename} of tables) {
					const [state] = await runner.query(
						`SELECT COUNT(*)::int AS count, md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS hash FROM ${ds.driver.escape(tablename)} t`,
					);
					rows.push({tablename, ...state});
				}
				return rows;
			};
			const before = await snapshot();
			const migration = ds.migrations.find((migration) => migration.name?.startsWith('AddPersonalAccessTokens'));
			await migration?.up(runner);
			await migration?.up(runner);
			expect(await runner.hasTable('personal_access_tokens')).toBe(true);
			expect(await snapshot()).toEqual(before);
			const [{id}] = await runner.query('SELECT id FROM accounts ORDER BY id LIMIT 1');
			const tokens = runner.manager.getRepository(PersonalAccessToken);
			const saved = await tokens.save(
				tokens.create({
					accountId: id,
					name: 'Example migration client',
					tokenHash: 'a'.repeat(64),
					prefix: 'tempo_pat_example',
				}),
			);
			expect((await tokens.findOneByOrFail({id: saved.id})).scopes).toEqual(['read']);
			await runner.query('SAVEPOINT duplicate_token_hash');
			await expect(
				tokens.insert({
					accountId: id,
					name: 'Example duplicate client',
					tokenHash: 'a'.repeat(64),
					prefix: 'tempo_pat_example',
				}),
			).rejects.toMatchObject({code: '23505'});
			await runner.query('ROLLBACK TO SAVEPOINT duplicate_token_hash');
			await runner.query('DELETE FROM accounts WHERE id = $1', [id]);
			expect(await runner.query('SELECT id FROM personal_access_tokens WHERE id = $1', [saved.id])).toEqual([]);
			await migration!.down(runner);
			expect(await runner.hasTable('personal_access_tokens')).toBe(false);
			await migration!.up(runner);
			expect(await runner.hasTable('personal_access_tokens')).toBe(true);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
		}
	});
	it('reads only the token owner ledger without creating or touching a supplied session', async () => {
		const app = getApp();
		const server = app.getHttpServer();
		const ds = app.get(DataSource);
		const owner = await ds.getRepository(Account).findOneByOrFail({email: VERIFIED_ACCOUNT_EMAIL});
		const otherOwner = await ds.getRepository(Account).findOneByOrFail({email: SESSION_TEST_ACCOUNT_EMAIL});
		const fixtures = new BankingFixtures(app);
		const otherConnection = await fixtures.createConnection(otherOwner, {aspspName: 'Example Other Bank'});
		const otherBankAccount = await fixtures.createBankAccount(otherConnection, {
			currentBalanceAmount: '999999.00',
			balanceUpdatedAt: new Date(),
		});
		const otherRow = await fixtures.createTransaction(otherBankAccount, bookedRow('2026-01-04', '-9999.00'));
		const connection = await fixtures.createConnection(owner, {aspspName: 'Example Bank'});
		const bankAccount = await fixtures.createBankAccount(connection, {
			currentBalanceAmount: '123.00',
			balanceUpdatedAt: new Date(),
		});
		const row = await fixtures.createTransaction(bankAccount, bookedRow('2026-01-04', '-3.25'));
		const agent = await loginAgent(server, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		const {body: created} = await agent
			.post(PATH)
			.set('Origin', ORIGIN)
			.send({name: 'Example read client'})
			.expect(201);
		const otherAgent = await loginAgent(server, SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);
		const redis = app.get<Redis>(REDIS);
		const prefix = app.get(ConfigurationService).get('SESSION_REDIS_KEY');
		const sessionKeys = (await redis.keys(`${prefix}:*`)).sort();
		const before = await redis.mget(sessionKeys);
		const ttlBefore = await Promise.all(sessionKeys.map((key) => redis.pttl(key)));
		const read = await request(server)
			.get(`/bank-transactions/${row.id}`)
			.auth(created.token, {type: 'bearer'})
			.expect(200);
		expect(read.body.id).toBe(row.id);
		expect(read.headers['set-cookie']).toBeUndefined();
		const cookieRead = await otherAgent.get('/bank-transactions').auth(created.token, {type: 'bearer'}).expect(200);
		expect(cookieRead.body.transactions.map(({id}: {id: string}) => id)).toContain(row.id);
		expect(cookieRead.headers['set-cookie']).toBeUndefined();
		expect(cookieRead.body.transactions.map(({id}: {id: string}) => id)).not.toContain(otherRow.id);
		await otherAgent.get(`/bank-transactions/${otherRow.id}`).auth(created.token, {type: 'bearer'}).expect(404);
		const totals = await otherAgent
			.get('/bank-transactions/totals')
			.auth(created.token, {type: 'bearer'})
			.expect(200);
		expect(totals.body).toMatchObject({count: 1, spending: '3.25', income: '0.00'});
		const connections = await otherAgent.get('/bank-connections').auth(created.token, {type: 'bearer'}).expect(200);
		expect(JSON.stringify(connections.body)).toContain(bankAccount.id);
		expect(JSON.stringify(connections.body)).not.toContain(otherBankAccount.id);
		const trend = await otherAgent
			.get('/bank-transactions/balance-trend?interval=month&from=2026-01-01&to=2026-01-31&asOf=2026-02-01')
			.auth(created.token, {type: 'bearer'})
			.expect(200);
		expect(JSON.stringify(trend.body)).toContain(bankAccount.id);
		expect(JSON.stringify(trend.body)).not.toContain(otherBankAccount.id);
		await otherAgent
			.post('/auth/login')
			.auth(created.token, {type: 'bearer'})
			.send({email: VERIFIED_ACCOUNT_EMAIL, password: VERIFIED_ACCOUNT_PASSWORD})
			.expect(403);
		await otherAgent.get(PATH).auth(created.token, {type: 'bearer'}).expect(403);
		expect((await redis.keys(`${prefix}:*`)).sort()).toEqual(sessionKeys);
		expect(await redis.mget(sessionKeys)).toEqual(before);
		const ttlAfter = await Promise.all(sessionKeys.map((key) => redis.pttl(key)));
		ttlAfter.forEach((ttl, index) => expect(ttl).toBeLessThanOrEqual(ttlBefore[index]));
		const [used] = await ds.query('SELECT "lastUsedAt" FROM personal_access_tokens WHERE id = $1', [created.id]);
		expect(used.lastUsedAt).toBeInstanceOf(Date);
		await request(server).get('/bank-connections').auth(created.token, {type: 'bearer'}).expect(200);
		const [again] = await ds.query('SELECT "lastUsedAt" FROM personal_access_tokens WHERE id = $1', [created.id]);
		expect(again.lastUsedAt).toEqual(used.lastUsedAt);
		await ds.query(
			`UPDATE personal_access_tokens SET "lastUsedAt" = CURRENT_TIMESTAMP - INTERVAL '2 minutes' WHERE id = $1`,
			[created.id],
		);
		await Promise.all(
			[1, 2, 3].map(() =>
				request(server).get('/bank-transactions').auth(created.token, {type: 'bearer'}).expect(200),
			),
		);
		const [renewed] = await ds.query('SELECT "lastUsedAt" FROM personal_access_tokens WHERE id = $1', [created.id]);
		expect(renewed.lastUsedAt.getTime()).toBeGreaterThanOrEqual(used.lastUsedAt.getTime());
		await agent.delete(`${PATH}/${created.id}`).set('Origin', ORIGIN).expect(204);
		const revokedSnapshot = await redis.mget(sessionKeys);
		const revokedResponse = await otherAgent
			.get('/bank-transactions')
			.auth(created.token, {type: 'bearer'})
			.expect(401);
		const invalidResponse = await otherAgent
			.get('/bank-transactions')
			.auth('tempo_pat_invalid', {type: 'bearer'})
			.expect(401);
		expect(revokedResponse.headers['set-cookie']).toBeUndefined();
		expect(invalidResponse.headers['set-cookie']).toBeUndefined();
		expect(await redis.mget(sessionKeys)).toEqual(revokedSnapshot);
		await fixtures.connections.delete([connection.id, otherConnection.id]);
	});
	it.each([
		{},
		{name: ''},
		{name: '   '},
		{name: 'x'.repeat(101)},
		{name: 42},
		{name: 'Example client', expiresInDays: 7},
		{name: 'Example client', expiresInDays: '90'},
		{name: 'Example client', expiresInDays: 0},
	])('rejects an invalid token name or lifetime %j', async (body) => {
		const agent = await loginAgent(getApp().getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		await agent.post(PATH).set('Origin', ORIGIN).send(body).expect(400);
	});

	it('requires the configured web origin for token creation and revocation', async () => {
		const agent = await loginAgent(getApp().getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		for (const origin of [undefined, 'null', 'https://untrusted.example.test']) {
			const create = agent.post(PATH).send({name: 'Example denied client'});
			if (origin) create.set('Origin', origin);
			await create.expect(403);
		}
		const {body: created} = await agent
			.post(PATH)
			.set('Origin', ORIGIN)
			.send({name: 'x'.repeat(100)})
			.expect(201);
		for (const origin of [undefined, 'null', 'https://untrusted.example.test']) {
			const remove = agent.delete(`${PATH}/${created.id}`);
			if (origin) remove.set('Origin', origin);
			await remove.expect(403);
		}
		expect((await agent.get(PATH).expect(200)).body.map(({id}: {id: string}) => id)).toContain(created.id);
		await agent.delete(`${PATH}/${created.id}`).set('Origin', ORIGIN).expect(204);
	});

	it('creates a read-only secret once, lists active metadata and revokes it', async () => {
		const app = getApp();
		const agent = await loginAgent(app.getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		const {body: created} = await agent
			.post(PATH)
			.set('Origin', ORIGIN)
			.send({name: '  Example client  '})
			.expect(201);
		expect(created).toMatchObject({name: 'Example client', scopes: ['read'], lastUsedAt: null});
		expect(Object.keys(created).sort()).toEqual(
			['id', 'name', 'prefix', 'scopes', 'createdAt', 'lastUsedAt', 'expiresAt', 'token'].sort(),
		);
		// Without an explicit lifetime a token lasts 90 days.
		const lifetime = new Date(created.expiresAt).getTime() - new Date(created.createdAt).getTime();
		expect(Math.abs(lifetime - 90 * 86_400_000)).toBeLessThan(60_000);
		const otherAgent = await loginAgent(
			app.getHttpServer(),
			SESSION_TEST_ACCOUNT_EMAIL,
			SESSION_TEST_ACCOUNT_PASSWORD,
		);
		expect((await otherAgent.get(PATH).expect(200)).body).toEqual([]);
		await otherAgent.delete(`${PATH}/${created.id}`).set('Origin', ORIGIN).expect(404);
		expect(created.token).toMatch(/^tempo_pat_[A-Za-z0-9_-]{43}$/);
		expect(created.token.startsWith(created.prefix)).toBe(true);
		const {body: listed} = await agent.get(PATH).expect(200);
		const {token, ...metadata} = created;
		expect(listed).toEqual([metadata]);
		const [stored] = await app
			.get(DataSource)
			.query('SELECT * FROM personal_access_tokens WHERE id = $1', [created.id]);
		expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
		expect(JSON.stringify(stored)).not.toContain(token);
		expect(JSON.stringify(listed)).not.toContain(stored.tokenHash);
		await agent.delete(`${PATH}/${created.id}`).set('Origin', ORIGIN).expect(204);
		expect((await agent.get(PATH).expect(200)).body).toEqual([]);
	});
	it('expires a token after its chosen lifetime, keeping it listed until revoked', async () => {
		const app = getApp();
		const server = app.getHttpServer();
		const agent = await loginAgent(server, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		const create = async (expiresInDays: number | null) =>
			(
				await agent
					.post(PATH)
					.set('Origin', ORIGIN)
					.send({name: `Example ${expiresInDays ?? 'lasting'} client`, expiresInDays})
					.expect(201)
			).body;
		const days = (token: {createdAt: string; expiresAt: string}) =>
			Math.round((new Date(token.expiresAt).getTime() - new Date(token.createdAt).getTime()) / 86_400_000);
		const month = await create(30);
		const year = await create(365);
		const lasting = await create(null);
		expect(days(month)).toBe(30);
		expect(days(year)).toBe(365);
		expect(lasting.expiresAt).toBeNull();
		await request(server).get('/bank-connections').auth(month.token, {type: 'bearer'}).expect(200);
		await app
			.get(DataSource)
			.query(
				`UPDATE personal_access_tokens SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1`,
				[month.id],
			);
		const expired = await request(server).get('/bank-connections').auth(month.token, {type: 'bearer'}).expect(401);
		expect(expired.headers['set-cookie']).toBeUndefined();
		await request(server).get('/bank-connections').auth(lasting.token, {type: 'bearer'}).expect(200);
		const listed: Array<{id: string; expiresAt: string | null}> = (await agent.get(PATH).expect(200)).body;
		expect(listed.find(({id}) => id === month.id)?.expiresAt).toEqual(expect.any(String));
		for (const {id} of [month, year, lasting])
			await agent.delete(`${PATH}/${id}`).set('Origin', ORIGIN).expect(204);
	});
});
