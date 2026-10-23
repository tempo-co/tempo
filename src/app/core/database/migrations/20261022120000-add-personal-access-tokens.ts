import {MigrationInterface, QueryRunner} from 'typeorm';

export class AddPersonalAccessTokens20261022120000 implements MigrationInterface {
	name = 'AddPersonalAccessTokens20261022120000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// Fresh installations are bootstrapped from entities by the schema script.
		if (!(await queryRunner.hasTable('accounts'))) return;
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "personal_access_tokens" (
			"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
			"accountId" uuid NOT NULL,
			"name" varchar(100) NOT NULL,
			"tokenHash" varchar(64) NOT NULL,
			"prefix" varchar(24) NOT NULL,
			"scopes" text[] NOT NULL DEFAULT ARRAY['read']::text[],
			"createdAt" timestamptz NOT NULL DEFAULT now(),
			"lastUsedAt" timestamptz,
			"expiresAt" timestamptz,
			"revokedAt" timestamptz,
			CONSTRAINT "pk_personal_access_tokens" PRIMARY KEY ("id"),
			CONSTRAINT "fk_personal_access_tokens_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query(
			'CREATE UNIQUE INDEX IF NOT EXISTS "idx_personal_access_tokens_token_hash" ON "personal_access_tokens" ("tokenHash")',
		);
		await queryRunner.query(
			'CREATE INDEX IF NOT EXISTS "idx_personal_access_tokens_account" ON "personal_access_tokens" ("accountId")',
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE IF EXISTS "personal_access_tokens"');
	}
}
