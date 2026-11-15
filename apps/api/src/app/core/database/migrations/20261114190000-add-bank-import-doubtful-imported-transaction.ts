import {MigrationInterface, QueryRunner} from 'typeorm';

/** A question a sync raises about an imported row already in history: which stored row it is about. */
export class AddBankImportDoubtfulImportedTransaction20261114190000 implements MigrationInterface {
	name = 'AddBankImportDoubtfulImportedTransaction20261114190000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('bank_import_doubtful_rows'))) return;
		await queryRunner.query(
			'ALTER TABLE "bank_import_doubtful_rows" ADD COLUMN IF NOT EXISTS "importedTransactionId" uuid',
		);
		await queryRunner.query(`DO $$ BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bank_import_doubtful_rows_imported_transaction') THEN
				ALTER TABLE "bank_import_doubtful_rows" ADD CONSTRAINT "fk_bank_import_doubtful_rows_imported_transaction"
					FOREIGN KEY ("importedTransactionId") REFERENCES "bank_transactions"("id") ON DELETE CASCADE;
			END IF;
		END $$`);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_import_doubtful_rows_imported_transaction" ON "bank_import_doubtful_rows" ("importedTransactionId")',
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP INDEX IF EXISTS "idx_bank_import_doubtful_rows_imported_transaction"');
		await queryRunner.query(
			'ALTER TABLE "bank_import_doubtful_rows" DROP CONSTRAINT IF EXISTS "fk_bank_import_doubtful_rows_imported_transaction"',
		);
		await queryRunner.query(
			'ALTER TABLE "bank_import_doubtful_rows" DROP COLUMN IF EXISTS "importedTransactionId"',
		);
	}
}
