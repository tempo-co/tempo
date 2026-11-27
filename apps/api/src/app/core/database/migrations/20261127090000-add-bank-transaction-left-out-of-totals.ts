import {MigrationInterface, QueryRunner} from 'typeorm';

/** The owner's choice to leave a row out of totals; every existing row keeps counting. */
export class AddBankTransactionLeftOutOfTotals20261127090000 implements MigrationInterface {
	name = 'AddBankTransactionLeftOutOfTotals20261127090000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		// A constant default fills existing rows without rewriting them, so the history-change trigger notes nothing.
		await queryRunner.query(
			`ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "leftOutOfTotals" boolean NOT NULL DEFAULT false`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		await queryRunner.query(`ALTER TABLE "bank_transactions" DROP COLUMN IF EXISTS "leftOutOfTotals"`);
	}
}
