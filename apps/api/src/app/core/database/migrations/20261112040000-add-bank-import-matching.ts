import {MigrationInterface, QueryRunner} from 'typeorm';

export class AddBankImportMatching20261112040000 implements MigrationInterface {
	name = 'AddBankImportMatching20261112040000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('accounts'))) return;
		for (const column of ['rowsMatchedByReference', 'rowsMatchedByBalance', 'rowsMatchedByDate']) {
			await queryRunner.query(
				`ALTER TABLE "bank_imports" ADD COLUMN IF NOT EXISTS "${column}" integer NOT NULL DEFAULT 0`,
			);
		}
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "bank_import_doubtful_rows" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"importId" uuid NOT NULL,
			"bankAccountId" uuid NOT NULL,
			"row" jsonb NOT NULL,
			"candidateTransactionIds" uuid array NOT NULL,
			"resolution" varchar(16),
			"resolvedTransactionId" uuid,
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			"updatedAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "pk_bank_import_doubtful_rows" PRIMARY KEY ("id"),
			CONSTRAINT "fk_bank_import_doubtful_rows_import" FOREIGN KEY ("importId") REFERENCES "bank_imports"("id") ON DELETE CASCADE,
			CONSTRAINT "fk_bank_import_doubtful_rows_bank_account" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE,
			CONSTRAINT "fk_bank_import_doubtful_rows_resolved_transaction" FOREIGN KEY ("resolvedTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL
		)`);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_import_doubtful_rows_import" ON "bank_import_doubtful_rows" ("importId")',
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE IF EXISTS "bank_import_doubtful_rows"');
		for (const column of ['rowsMatchedByDate', 'rowsMatchedByBalance', 'rowsMatchedByReference']) {
			await queryRunner.query(`ALTER TABLE "bank_imports" DROP COLUMN IF EXISTS "${column}"`);
		}
	}
}
