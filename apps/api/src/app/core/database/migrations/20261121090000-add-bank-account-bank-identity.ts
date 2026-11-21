import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * Records the bank that holds each account, and fills it for accounts of bank connections from the connection's
 * institution name, as authorization writes it (`nameBankIdentity`, copied here so this migration keeps its output).
 * Imported-files accounts start without one. Also records which file import gave an account its bank
 * (`bankIdentityImportId`), none so far.
 */
export class AddBankAccountBankIdentity20261121090000 implements MigrationInterface {
	name = 'AddBankAccountBankIdentity20261121090000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_accounts'))) return;
		if (!(await queryRunner.hasColumn('bank_accounts', 'bankIdentity'))) {
			await queryRunner.query(`ALTER TABLE "bank_accounts" ADD "bankIdentity" character varying`);
		}
		if (!(await queryRunner.hasColumn('bank_accounts', 'bankIdentityImportId'))) {
			await queryRunner.query(`ALTER TABLE "bank_accounts" ADD "bankIdentityImportId" uuid`);
			await queryRunner.query(
				`ALTER TABLE "bank_accounts" ADD CONSTRAINT "fk_bank_accounts_bank_identity_import"
				FOREIGN KEY ("bankIdentityImportId") REFERENCES "bank_imports"("id") ON DELETE SET NULL`,
			);
		}
		const connections = (await queryRunner.query(
			`SELECT "id", "aspspName" FROM "bank_connections" WHERE "provider" <> 'file' ORDER BY "id"`,
		)) as Array<{id: string; aspspName: string}>;
		for (const {id, aspspName} of connections) {
			const identity = `name:${aspspName.trim().replace(/\s+/g, ' ').toLowerCase()}`;
			await queryRunner.query(
				`UPDATE "bank_accounts" SET "bankIdentity" = $2
				WHERE "bankConnectionId" = $1 AND "bankIdentity" IS DISTINCT FROM $2`,
				[id, identity],
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_accounts'))) return;
		await queryRunner.query(`ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "bankIdentityImportId"`);
		await queryRunner.query(`ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "bankIdentity"`);
	}
}
