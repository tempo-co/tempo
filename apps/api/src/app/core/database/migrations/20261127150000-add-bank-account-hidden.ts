import {MigrationInterface, QueryRunner} from 'typeorm';

/** The owner's choice to hide an account from lists and totals; every existing account stays shown. */
export class AddBankAccountHidden20261127150000 implements MigrationInterface {
	name = 'AddBankAccountHidden20261127150000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('bank_accounts'))) return;
		// A constant default fills existing rows without rewriting the table.
		await queryRunner.query(
			`ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "isHidden" boolean NOT NULL DEFAULT false`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_accounts'))) return;
		await queryRunner.query(`ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "isHidden"`);
	}
}
