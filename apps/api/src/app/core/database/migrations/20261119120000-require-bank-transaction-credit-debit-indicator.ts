import {MigrationInterface, QueryRunner} from 'typeorm';

const CONSTRAINT_NAME = 'chk_bank_transactions_credit_debit_indicator';

/**
 * Every transaction is a credit or a debit: bank sync and file imports refuse rows without one, so the column is
 * required and limited to `CRDT` and `DBIT`. Fails on a row holding anything else rather than guessing its direction.
 */
export class RequireBankTransactionCreditDebitIndicator20261119120000 implements MigrationInterface {
	name = 'RequireBankTransactionCreditDebitIndicator20261119120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		await queryRunner.query('ALTER TABLE "bank_transactions" ALTER COLUMN "creditDebitIndicator" SET NOT NULL');
		if (await hasConstraint(queryRunner)) return;
		await queryRunner.query(
			`ALTER TABLE "bank_transactions"
			ADD CONSTRAINT "${CONSTRAINT_NAME}" CHECK ("creditDebitIndicator" IN ('CRDT', 'DBIT'))`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		await queryRunner.query(`ALTER TABLE "bank_transactions" DROP CONSTRAINT IF EXISTS "${CONSTRAINT_NAME}"`);
		await queryRunner.query('ALTER TABLE "bank_transactions" ALTER COLUMN "creditDebitIndicator" DROP NOT NULL');
	}
}

async function hasConstraint(queryRunner: QueryRunner): Promise<boolean> {
	const [{exists}] = (await queryRunner.query(
		`SELECT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conname = $1 AND conrelid = 'bank_transactions'::regclass
		) AS "exists"`,
		[CONSTRAINT_NAME],
	)) as Array<{exists: boolean}>;
	return exists;
}
