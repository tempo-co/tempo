import {DataSource, QueryRunner} from 'typeorm';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const MIGRATION_NAME = 'RestampSameDayRowsNewestFirst20261119090000';
// One write of an older build: every row it stored shares this value.
const WRITTEN_AT = '2026-03-04T10:00:00.123456Z';
const LATER_WRITE_AT = '2026-03-05T08:00:00.000000Z';

function withBalance(bookingDate: string, amount: string, balanceAfterAmount: string) {
	return bookedRow(bookingDate, amount, {balanceAfterAmount, balanceAfterCurrency: 'EUR'});
}

describe('RestampSameDayRowsNewestFirst migration', () => {
	it('stamps a shared-time day group newest first where its balances chain one way only and keeps every other row', async () => {
		const app = getApp();
		const ds = app.get(DataSource);
		const fixtures = new BankingFixtures(app);
		const {connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		const otherBankAccount = await fixtures.createBankAccount(connection);
		// The day ran 100.00 → oldest → middle → newest, stored in another order.
		const [newest, oldest, middle] = await fixtures.createTransactions(bankAccount, [
			withBalance('2026-03-02', '-5.00', '110.00'),
			withBalance('2026-03-02', '-10.00', '90.00'),
			withBalance('2026-03-02', '25.00', '115.00'),
		]);
		// A payment, its refund and the payment again: the two payments could swap.
		const equalAmounts = await fixtures.createTransactions(bankAccount, [
			withBalance('2026-03-03', '-5.00', '95.00'),
			withBalance('2026-03-03', '5.00', '100.00'),
			withBalance('2026-03-03', '-5.00', '95.00'),
		]);
		// Neither row's balance leads to the other's.
		const unlinked = await fixtures.createTransactions(bankAccount, [
			withBalance('2026-03-04', '-1.00', '60.00'),
			withBalance('2026-03-04', '-2.00', '40.00'),
		]);
		const withoutBalances = await fixtures.createTransactions(otherBankAccount, [
			bookedRow('2026-03-02', '-7.00'),
			bookedRow('2026-03-02', '-8.00'),
		]);
		// Rows written apart keep their stamps, even listed against their balances.
		const writtenApart = await fixtures.createTransactions(otherBankAccount, [
			withBalance('2026-03-03', '-1.00', '49.00'),
			withBalance('2026-03-03', '-2.00', '47.00'),
		]);
		// A chain whose new stamps would pass a row of the same day written a microsecond earlier.
		const crowded = await fixtures.createTransactions(otherBankAccount, [
			withBalance('2026-03-04', '-3.00', '17.00'),
			withBalance('2026-03-04', '-4.00', '13.00'),
		]);
		const crowdingRow = await fixtures.createTransaction(
			otherBankAccount,
			withBalance('2026-03-04', '-9.00', '1.00'),
		);
		const sharedTime = [newest, oldest, middle, ...equalAmounts, ...unlinked, ...withoutBalances, ...crowded];
		const accountIds = [bankAccount.id, otherBankAccount.id];

		const runner = ds.createQueryRunner();
		await runner.startTransaction();
		try {
			const stamp = (ids: string[], at: string) =>
				runner.query(`UPDATE bank_transactions SET "createdAt" = $2::timestamptz WHERE id = ANY($1::uuid[])`, [
					ids,
					at,
				]);
			await stamp(
				sharedTime.map(({id}) => id),
				WRITTEN_AT,
			);
			await stamp([writtenApart[0].id], WRITTEN_AT);
			await stamp([writtenApart[1].id], LATER_WRITE_AT);
			await runner.query(
				`UPDATE bank_transactions SET "createdAt" = $2::timestamptz - interval '1 microsecond' WHERE id = $1`,
				[crowdingRow.id, WRITTEN_AT],
			);
			const before = {
				listed: await listedIds(runner, accountIds),
				untouched: await rowStates(runner, accountIds, [oldest.id, middle.id]),
			};
			const migration = ds.migrations.find(({name}) => name === MIGRATION_NAME);
			expect(migration).toBeDefined();

			await migration!.up(runner);

			expect(await microsecondsBefore(runner, [newest.id, middle.id, oldest.id])).toEqual({
				[newest.id]: 0,
				[middle.id]: 1,
				[oldest.id]: 2,
			});
			const listed = await listedIds(runner, accountIds);
			expect(listed[`${bankAccount.id} 2026-03-02`]).toEqual([newest.id, middle.id, oldest.id]);
			expect(Object.keys(listed)).toEqual(Object.keys(before.listed));
			for (const day of Object.keys(listed).filter((key) => key !== `${bankAccount.id} 2026-03-02`)) {
				expect(listed[day]).toEqual(before.listed[day]);
			}
			expect(await rowStates(runner, accountIds, [oldest.id, middle.id])).toEqual(before.untouched);

			const once = await rowStates(runner, accountIds, []);
			await migration!.up(runner);
			expect(await rowStates(runner, accountIds, [])).toEqual(once);
			await migration!.down(runner);
			expect(await rowStates(runner, accountIds, [])).toEqual(once);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
			await fixtures.connections.delete(connection.id);
		}
	});
});

/** Each account day's row ids in the transaction list's order. */
async function listedIds(runner: QueryRunner, accountIds: string[]): Promise<Record<string, string[]>> {
	const rows: Array<{day: string; ids: string[]}> = await runner.query(
		`SELECT "bankAccountId" || ' ' || "bookingDate"::text AS day,
			array_agg(id::text ORDER BY "valueDate" DESC NULLS LAST, "createdAt" DESC, id DESC) AS ids
		FROM bank_transactions WHERE "bankAccountId" = ANY($1::uuid[]) GROUP BY 1 ORDER BY 1`,
		[accountIds],
	);
	return Object.fromEntries(rows.map(({day, ids}) => [day, ids]));
}

/** Every column of the accounts' rows other than these, with their exact stamps. */
function rowStates(runner: QueryRunner, accountIds: string[], exceptIds: string[]) {
	return runner.query(
		`SELECT to_jsonb(t) - 'createdAt' AS state, to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS stamp
		FROM bank_transactions t WHERE "bankAccountId" = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[])) ORDER BY id`,
		[accountIds, exceptIds],
	);
}

async function microsecondsBefore(runner: QueryRunner, ids: string[]): Promise<Record<string, number>> {
	const rows: Array<{id: string; behind: number}> = await runner.query(
		`SELECT id, (EXTRACT(EPOCH FROM ($2::timestamptz - "createdAt")) * 1000000)::int AS behind
		FROM bank_transactions WHERE id = ANY($1::uuid[])`,
		[ids, WRITTEN_AT],
	);
	return Object.fromEntries(rows.map(({id, behind}) => [id, behind]));
}
