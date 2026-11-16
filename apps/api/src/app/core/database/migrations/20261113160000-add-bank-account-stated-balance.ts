import {MigrationInterface, QueryRunner} from 'typeorm';

export class AddBankAccountStatedBalance20261113160000 implements MigrationInterface {
	name = 'AddBankAccountStatedBalance20261113160000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('bank_accounts'))) return;
		await queryRunner.query(
			'ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "statedBalanceAmount" numeric(20,8)',
		);
		await queryRunner.query('ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "statedBalanceDate" date');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "statedBalanceDate"');
		await queryRunner.query('ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "statedBalanceAmount"');
	}
}
