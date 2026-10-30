import argon2 from 'argon2';

import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_NAME} from '../../scripts/seed-data/seed.constants';
import {assertStagingDatabaseTarget, resetSingleStagingAccountPassword} from './set-staging-password';

interface QueryCall {
	sql: string;
	values?: unknown[];
}

function reset(queryable: unknown, password: string) {
	return resetSingleStagingAccountPassword(
		queryable as Parameters<typeof resetSingleStagingAccountPassword>[0],
		password,
	);
}

function fakeQueryable(accountIds: string[], updateRowCount = 1) {
	const calls: QueryCall[] = [];
	const query = jest.fn(async (sql: string, values?: unknown[]) => {
		calls.push({sql, values});
		if (sql === 'SELECT id FROM accounts') return accountIds.map((id) => ({id}));
		if (sql.startsWith('UPDATE accounts SET password = $1')) {
			return [
				Array.from({length: updateRowCount}, (_, index) => ({id: `updated-account-${index}`})),
				updateRowCount,
			];
		}
		throw new Error('unexpected SQL in staging password test');
	});
	return {queryable: {query}, calls, query};
}

describe('staging account password reset', () => {
	it('accepts only the dedicated staging refresh database and local Postgres service', () => {
		expect(() => assertStagingDatabaseTarget('tempo_staging_refresh', 'postgres')).not.toThrow();
		expect(() => assertStagingDatabaseTarget('tempo_staging', 'postgres')).toThrow(
			'staging refresh database host and name',
		);
		expect(() => assertStagingDatabaseTarget('tempo_staging_refresh', 'production-db.internal')).toThrow(
			'staging refresh database host and name',
		);
	});

	it('resets the password and replaces the sole account identity with the generic staging identity', async () => {
		const password = 'Synthetic-stage-passphrase-42';
		const accountId = 'synthetic-account-id';
		const {queryable, calls} = fakeQueryable([accountId]);

		await reset(queryable, password);

		expect(calls).toHaveLength(2);
		expect(calls[0].sql).toBe('SELECT id FROM accounts');
		expect(calls[1].sql).toContain(
			'UPDATE accounts SET password = $1, name = $2, email = $3, "updatedAt" = NOW() WHERE id = $4',
		);
		expect(calls[1].values?.[1]).toBe(VERIFIED_ACCOUNT_NAME);
		expect(calls[1].values?.[2]).toBe(VERIFIED_ACCOUNT_EMAIL);
		expect(calls[1].values?.[3]).toBe(accountId);
		expect(await argon2.verify(calls[1].values?.[0] as string, password)).toBe(true);
	});

	it('refuses to reset zero or multiple accounts', async () => {
		for (const ids of [[], ['first-account', 'second-account']]) {
			const {queryable, query} = fakeQueryable(ids);
			await expect(reset(queryable, 'Synthetic-stage-passphrase-42')).rejects.toThrow(
				'exactly one staging account',
			);
			expect(query).toHaveBeenCalledTimes(1);
		}
	});

	it('refuses a password update that did not affect exactly one account', async () => {
		const {queryable} = fakeQueryable(['synthetic-account-id'], 0);
		await expect(reset(queryable, 'Synthetic-stage-passphrase-42')).rejects.toThrow(
			'password update did not affect exactly one staging account',
		);
	});
});
