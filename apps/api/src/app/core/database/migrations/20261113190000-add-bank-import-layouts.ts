import {MigrationInterface, QueryRunner} from 'typeorm';

export class AddBankImportLayouts20261113190000 implements MigrationInterface {
	name = 'AddBankImportLayouts20261113190000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('accounts'))) return;
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "bank_import_layout_proposals" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"accountId" uuid NOT NULL,
			"fileHash" varchar(64) NOT NULL,
			"status" varchar(16) NOT NULL,
			"failureCode" varchar(32),
			"headerCells" jsonb,
			"columnShapes" jsonb,
			"layout" jsonb,
			"currencyNeeded" boolean NOT NULL DEFAULT false,
			"expiresAt" timestamptz NOT NULL,
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			"updatedAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "pk_bank_import_layout_proposals" PRIMARY KEY ("id"),
			CONSTRAINT "fk_bank_import_layout_proposals_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_import_layout_proposals_account_created" ON "bank_import_layout_proposals" ("accountId", "createdAt")',
		);
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "bank_import_layouts" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"accountId" uuid NOT NULL,
			"layout" jsonb NOT NULL,
			"bankName" varchar(60) NOT NULL,
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "pk_bank_import_layouts" PRIMARY KEY ("id"),
			CONSTRAINT "fk_bank_import_layouts_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_bank_import_layouts_account_created" ON "bank_import_layouts" ("accountId", "createdAt")',
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE IF EXISTS "bank_import_layouts"');
		await queryRunner.query('DROP TABLE IF EXISTS "bank_import_layout_proposals"');
	}
}
