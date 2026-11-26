import {MigrationInterface, QueryRunner} from 'typeorm';

export class AddBankImportPickedBank20261126090000 implements MigrationInterface {
	name = 'AddBankImportPickedBank20261126090000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('bank_imports'))) return;
		for (const table of ['bank_imports', 'bank_import_layouts', 'bank_import_layout_proposals']) {
			await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "bankId" varchar(64)`);
		}
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "bank_import_layout_misses" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"accountId" uuid NOT NULL,
			"bankId" varchar(64) NOT NULL,
			"outcome" varchar(16) NOT NULL,
			"refusalCode" varchar(32),
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "pk_bank_import_layout_misses" PRIMARY KEY ("id"),
			CONSTRAINT "fk_bank_import_layout_misses_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_import_layout_misses_account_created" ON "bank_import_layout_misses" ("accountId", "createdAt")',
		);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_import_layout_misses_bank_created" ON "bank_import_layout_misses" ("bankId", "createdAt")',
		);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "bank_requests" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"accountId" uuid NOT NULL,
			"bankName" varchar(60) NOT NULL,
			"country" varchar(2) NOT NULL,
			"fileTypes" jsonb NOT NULL,
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "pk_bank_requests" PRIMARY KEY ("id"),
			CONSTRAINT "fk_bank_requests_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_requests_account_created" ON "bank_requests" ("accountId", "createdAt")',
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE IF EXISTS "bank_requests"');
		await queryRunner.query('DROP TABLE IF EXISTS "bank_import_layout_misses"');
		for (const table of ['bank_import_layout_proposals', 'bank_import_layouts', 'bank_imports']) {
			await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "bankId"`);
		}
	}
}
