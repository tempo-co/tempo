import {MigrationInterface, QueryRunner} from 'typeorm';

/** A row of a shared-stamp group, with its balances as exact numeric text. */
type GroupRow = {
	id: string;
	day: string;
	stamp: string;
	after: string | null;
	before: string | null;
	currency: string | null;
};

/**
 * Rows stored by one write before each row got its own `createdAt` share one, so a day's rows list in id order.
 * Each group of such rows (one account, booking date and `createdAt`) whose balances after chain them in one way only
 * is stamped as a write stamps rows now: the newest keeps the shared value, each older one a microsecond less. A row
 * follows the one whose balance after equals its own balance after minus its amount. A group stays as it is when a
 * row has no balance, two rows end or start at the same balance (equal amounts that could swap), the links do not
 * form one line through every row, or another row of the day sits within the new stamps. Runs per bank account.
 */
export class RestampSameDayRowsNewestFirst20261119090000 implements MigrationInterface {
	name = 'RestampSameDayRowsNewestFirst20261119090000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		const accounts = (await queryRunner.query(
			`SELECT DISTINCT "bankAccountId" AS "id" FROM "bank_transactions"`,
		)) as Array<{
			id: string;
		}>;
		for (const {id: bankAccountId} of accounts) {
			const rows = (await queryRunner.query(
				`SELECT "id", "day", "stamp", "after", "before", "currency" FROM (
					SELECT t."id", t."bookingDate"::text AS "day", t."createdAt"::text AS "stamp",
						t."balanceAfterAmount"::text AS "after", (t."balanceAfterAmount" - t."amount")::text AS "before",
						t."balanceAfterCurrency" AS "currency",
						COUNT(*) OVER (PARTITION BY t."bookingDate", t."createdAt") AS "size"
					FROM "bank_transactions" t
					WHERE t."bankAccountId" = $1 AND t."bookingDate" IS NOT NULL
				) shared WHERE "size" > 1`,
				[bankAccountId],
			)) as GroupRow[];
			const groups = new Map<string, GroupRow[]>();
			for (const row of rows) {
				const key = `${row.day} ${row.stamp}`;
				const group = groups.get(key) ?? [];
				group.push(row);
				groups.set(key, group);
			}
			// Each row's distance from its group's newest row; the newest itself keeps its stamp.
			const ids: string[] = [];
			const steps: number[] = [];
			const sizes: number[] = [];
			for (const group of groups.values()) {
				const oldestFirst = balanceChain(group);
				oldestFirst?.slice(0, -1).forEach((id, position) => {
					ids.push(id);
					steps.push(oldestFirst.length - 1 - position);
					sizes.push(oldestFirst.length);
				});
			}
			if (ids.length === 0) continue;
			await queryRunner.query(
				`UPDATE "bank_transactions" t
				SET "createdAt" = t."createdAt" - restamp."step" * interval '1 microsecond'
				FROM unnest($2::uuid[], $3::int[], $4::int[]) AS restamp("id", "step", "size")
				WHERE t."id" = restamp."id" AND t."bankAccountId" = $1
					AND NOT EXISTS (
						SELECT 1 FROM "bank_transactions" other
						WHERE other."bankAccountId" = t."bankAccountId" AND other."bookingDate" = t."bookingDate"
							AND other."createdAt" < t."createdAt"
							AND other."createdAt" >= t."createdAt" - (restamp."size" - 1) * interval '1 microsecond'
					)`,
				[bankAccountId, ids, steps, sizes],
			);
		}
	}

	public async down(): Promise<void> {
		// The rows of a group shared one `createdAt`, a tie that ordered nothing; there is no order to restore.
	}
}

/** The group's row ids oldest first, when their balances chain them in exactly one order through every row. */
function balanceChain(rows: readonly GroupRow[]): string[] | null {
	if (rows.some(({after, currency}) => after === null || currency === null)) return null;
	if (new Set(rows.map(({currency}) => currency)).size !== 1) return null;
	const byAfter = new Map(rows.map((row) => [row.after, row]));
	const byBefore = new Map(rows.map((row) => [row.before, row]));
	if (byAfter.size !== rows.length || byBefore.size !== rows.length) return null;

	// Each row has at most one previous and one next row now; the chain must start once and reach every row.
	const starts = rows.filter(({before}) => !byAfter.has(before));
	if (starts.length !== 1) return null;
	const chain = [starts[0]];
	for (let next = byBefore.get(starts[0].after); next && !chain.includes(next); next = byBefore.get(next.after)) {
		chain.push(next);
	}
	return chain.length === rows.length ? chain.map(({id}) => id) : null;
}
