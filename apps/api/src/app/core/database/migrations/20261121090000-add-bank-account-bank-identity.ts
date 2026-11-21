import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * Records the bank that holds each account, and fills it for accounts of bank connections from the connection's
 * institution name, as authorization writes it (`nameBankIdentity`, copied here so this migration keeps its output).
 * Imported-files accounts start without one.
 */
export class AddBankAccountBankIdentity20261121090000 implements MigrationInterface {
	name = 'AddBankAccountBankIdentity20261121090000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_accounts'))) return;
		if (!(await queryRunner.hasColumn('bank_accounts', 'bankIdentity'))) {
			await queryRunner.query(`ALTER TABLE "bank_accounts" ADD "bankIdentity" character varying`);
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
		if (await queryRunner.hasColumn('bank_accounts', 'bankIdentity')) {
			await queryRunner.dropColumn('bank_accounts', 'bankIdentity');
		}
	}
}
