import {DataSource} from 'typeorm';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'AddBankAccountHidden20261127150000';

describe('AddBankAccountHidden migration', () => {
	it('shows every existing account, keeps its other fields, and takes the owner’s choice', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const second = await fixtures.createBankAccount(connection, {name: 'Second account'});

		const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
		expect(migration).toBeDefined();
		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			await migration!.down(runner);
			expect(await runner.hasColumn('bank_accounts', 'isHidden')).toBe(false);
			const accounts = (): Promise<Array<{state: Record<string, unknown>}>> =>
				runner.query(
					'SELECT to_jsonb(a) AS state FROM bank_accounts a WHERE a."id" = ANY($1) ORDER BY a."id"',
					[[bankAccount.id, second.id]],
				);
			const before = await accounts();

			await migration!.up(runner);

			const flags = async () =>
				Object.fromEntries((await accounts()).map(({state}) => [state.id as string, state.isHidden]));
			expect(await flags()).toEqual({[bankAccount.id]: false, [second.id]: false});
			const withoutFlag = (states: Array<{state: Record<string, unknown>}>) =>
				states.map(({state: {isHidden: _flag, ...rest}}) => rest);
			expect(withoutFlag(await accounts())).toEqual(withoutFlag(before));

			await runner.query(`UPDATE "bank_accounts" SET "isHidden" = true WHERE "id" = $1`, [second.id]);
			expect(await flags()).toEqual({[bankAccount.id]: false, [second.id]: true});

			// A second run keeps the choice.
			await migration!.up(runner);
			expect(await flags()).toEqual({[bankAccount.id]: false, [second.id]: true});
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete(connection.id);
		}
	});
});
