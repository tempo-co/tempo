import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

const COLUMNS = ['syncCoveredFrom', 'syncCoveredThrough'];

/** Coverage starts empty: only complete fetches after this migration record it. */
export class AddBankAccountSyncCoverage20261114200000 implements MigrationInterface {
	name = 'AddBankAccountSyncCoverage20261114200000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_accounts'))) return;
		for (const name of COLUMNS) {
			if (await queryRunner.hasColumn('bank_accounts', name)) continue;
			await queryRunner.addColumn('bank_accounts', new TableColumn({name, type: 'date', isNullable: true}));
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_accounts'))) return;
		for (const name of [...COLUMNS].reverse()) {
			if (await queryRunner.hasColumn('bank_accounts', name)) await queryRunner.dropColumn('bank_accounts', name);
		}
	}
}
