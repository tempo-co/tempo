import {MigrationInterface, QueryRunner} from 'typeorm';

export class AddBankTransactionDate20261120090000 implements MigrationInterface {
	name = 'AddBankTransactionDate20261120090000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		if (!(await queryRunner.hasColumn('bank_transactions', 'date'))) {
			await queryRunner.query(
				`ALTER TABLE "bank_transactions" ADD "date" date GENERATED ALWAYS AS (COALESCE("transactionDate", "bookingDate", "valueDate")) STORED`,
			);
		}
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "idx_bank_transactions_account_date" ON "bank_transactions" ("bankAccountId", "date")`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_bank_transactions_account_date"`);
		if (await queryRunner.hasColumn('bank_transactions', 'date')) {
			await queryRunner.dropColumn('bank_transactions', 'date');
		}
	}
}
