import {MigrationInterface, QueryRunner} from 'typeorm';

export class AddBankImports20261111230000 implements MigrationInterface {
	name = 'AddBankImports20261111230000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('accounts'))) return;
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "bank_imports" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"accountId" uuid NOT NULL,
			"bankConnectionId" uuid NOT NULL,
			"fileHash" varchar(64) NOT NULL,
			"format" varchar(16) NOT NULL,
			"layout" varchar(64),
			"filesCount" integer NOT NULL,
			"rowsParsed" integer NOT NULL,
			"rowsAdded" integer NOT NULL,
			"rowsAlreadyPresent" integer NOT NULL,
			"rowsDoubtful" integer NOT NULL DEFAULT 0,
			"dateFrom" date,
			"dateTo" date,
			"bankAccountIds" uuid array NOT NULL,
			"createdBankAccountIds" uuid array NOT NULL,
			"undoneAt" timestamptz,
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "pk_bank_imports" PRIMARY KEY ("id"),
			CONSTRAINT "fk_bank_imports_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE,
			CONSTRAINT "fk_bank_imports_connection" FOREIGN KEY ("bankConnectionId") REFERENCES "bank_connections"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_imports_account_created" ON "bank_imports" ("accountId", "createdAt")',
		);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_imports_connection" ON "bank_imports" ("bankConnectionId")',
		);
		await queryRunner.query('ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "importId" uuid');
		await queryRunner.query(`DO $$ BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bank_transactions_import') THEN
				ALTER TABLE "bank_transactions" ADD CONSTRAINT "fk_bank_transactions_import"
					FOREIGN KEY ("importId") REFERENCES "bank_imports"("id") ON DELETE SET NULL;
			END IF;
		END $$`);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_transactions_import" ON "bank_transactions" ("importId")',
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "idx_bank_connections_file_owner" ON "bank_connections" ("accountId") WHERE "provider" = 'file'`,
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP INDEX IF EXISTS "idx_bank_connections_file_owner"');
		await queryRunner.query('DROP INDEX IF EXISTS "idx_bank_transactions_import"');
		await queryRunner.query(
			'ALTER TABLE "bank_transactions" DROP CONSTRAINT IF EXISTS "fk_bank_transactions_import"',
		);
		await queryRunner.query('ALTER TABLE "bank_transactions" DROP COLUMN IF EXISTS "importId"');
		await queryRunner.query('DROP TABLE IF EXISTS "bank_imports"');
	}
}
