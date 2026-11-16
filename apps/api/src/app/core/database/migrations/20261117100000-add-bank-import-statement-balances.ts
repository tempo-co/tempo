import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

/** Imports keep the closing balance their statements state per account, and the gaps between their statements. */
export class AddBankImportStatementBalances20261117100000 implements MigrationInterface {
	name = 'AddBankImportStatementBalances20261117100000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_imports'))) return;
		for (const name of ['closingBalances', 'statementGaps']) {
			if (await queryRunner.hasColumn('bank_imports', name)) continue;
			await queryRunner.addColumn(
				'bank_imports',
				new TableColumn({name, type: 'jsonb', isNullable: false, default: `'[]'::jsonb`}),
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_imports'))) return;
		for (const name of ['statementGaps', 'closingBalances']) {
			if (await queryRunner.hasColumn('bank_imports', name)) await queryRunner.dropColumn('bank_imports', name);
		}
	}
}
