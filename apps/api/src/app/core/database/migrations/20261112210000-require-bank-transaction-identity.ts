import {MigrationInterface, QueryRunner} from 'typeorm';

import {
	BANK_TRANSACTION_IDENTITY_ROW_V2_COLUMNS,
	BankTransactionIdentityRowV2,
	assignIncompleteBankTransactionIdentityKeysV2,
} from '../migration-support/bank-transaction-identity-v2';

const UPDATE_BATCH_SIZE = 500;
const INCOMPLETE_IDENTITY_SQL = `"stableIdentityKey" IS NULL OR "stableIdentityKey" = ''
	OR "stableIdentityGroupKey" IS NULL OR "stableIdentityGroupKey" = ''`;
const DEDUPE_INDEX_NAME = 'idx_bank_transactions_account_dedupe';

/**
 * Every transaction has a stable identity: completes the rows still missing one (the lowest free occurrence of the
 * row's group, as sync assigned them), makes both identity columns NOT NULL and drops the legacy `dedupeKey`.
 */
export class RequireBankTransactionIdentity20261112210000 implements MigrationInterface {
	name = 'RequireBankTransactionIdentity20261112210000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;

		// Occurrences are free per account, so read every row of the accounts that have an incomplete one.
		const rows = (await queryRunner.query(
			`SELECT ${BANK_TRANSACTION_IDENTITY_ROW_V2_COLUMNS}
			FROM "bank_transactions"
			WHERE "bankAccountId" IN (SELECT "bankAccountId" FROM "bank_transactions" WHERE ${INCOMPLETE_IDENTITY_SQL})
			ORDER BY "bankAccountId", id`,
		)) as BankTransactionIdentityRowV2[];
		const updates = assignIncompleteBankTransactionIdentityKeysV2(rows);
		for (let offset = 0; offset < updates.length; offset += UPDATE_BATCH_SIZE) {
			const batch = updates.slice(offset, offset + UPDATE_BATCH_SIZE);
			const values = batch.map((_, index) => `($${index * 3 + 1}::uuid, $${index * 3 + 2}, $${index * 3 + 3})`);
			await queryRunner.query(
				`UPDATE "bank_transactions" AS t
				SET "stableIdentityGroupKey" = batch."stableIdentityGroupKey", "stableIdentityKey" = batch."stableIdentityKey"
				FROM (VALUES ${values.join(', ')}) AS batch(id, "stableIdentityGroupKey", "stableIdentityKey")
				WHERE t.id = batch.id`,
				batch.flatMap(({id, stableIdentityGroupKey, stableIdentityKey}) => [
					id,
					stableIdentityGroupKey,
					stableIdentityKey,
				]),
			);
		}

		await queryRunner.query(
			`ALTER TABLE "bank_transactions"
			ALTER COLUMN "stableIdentityKey" SET NOT NULL,
			ALTER COLUMN "stableIdentityGroupKey" SET NOT NULL`,
		);
		await queryRunner.query(`DROP INDEX IF EXISTS "${DEDUPE_INDEX_NAME}"`);
		await queryRunner.query('ALTER TABLE "bank_transactions" DROP COLUMN IF EXISTS "dedupeKey"');
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;

		if (!(await queryRunner.hasColumn('bank_transactions', 'dedupeKey'))) {
			// A random UUID is what the previous sync stores for a row it no longer matches by a legacy key, so it keeps
			// working, and rolling back the stable identities (20260928154959) refuses.
			await queryRunner.query('ALTER TABLE "bank_transactions" ADD COLUMN "dedupeKey" varchar(64)');
			await queryRunner.query('UPDATE "bank_transactions" SET "dedupeKey" = gen_random_uuid()::text');
			await queryRunner.query('ALTER TABLE "bank_transactions" ALTER COLUMN "dedupeKey" SET NOT NULL');
			await queryRunner.query(
				`CREATE UNIQUE INDEX "${DEDUPE_INDEX_NAME}" ON "bank_transactions" ("bankAccountId", "dedupeKey")`,
			);
		}
		await queryRunner.query(
			`ALTER TABLE "bank_transactions"
			ALTER COLUMN "stableIdentityKey" DROP NOT NULL,
			ALTER COLUMN "stableIdentityGroupKey" DROP NOT NULL`,
		);
	}
}
