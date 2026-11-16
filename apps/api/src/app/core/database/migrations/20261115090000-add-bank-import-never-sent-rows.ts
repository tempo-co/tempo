import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

/** Rows of an import kept beside history get a kind; existing ones are all doubtful rows. */
export class AddBankImportNeverSentRows20261115090000 implements MigrationInterface {
	name = 'AddBankImportNeverSentRows20261115090000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (
			(await queryRunner.hasTable('bank_import_doubtful_rows')) &&
			!(await queryRunner.hasColumn('bank_import_doubtful_rows', 'kind'))
		) {
			await queryRunner.addColumn(
				'bank_import_doubtful_rows',
				new TableColumn({
					name: 'kind',
					type: 'varchar',
					length: '16',
					isNullable: false,
					default: `'doubtful'`,
				}),
			);
		}
		if (
			(await queryRunner.hasTable('bank_imports')) &&
			!(await queryRunner.hasColumn('bank_imports', 'rowsNotInBank'))
		) {
			await queryRunner.addColumn(
				'bank_imports',
				new TableColumn({name: 'rowsNotInBank', type: 'integer', isNullable: false, default: 0}),
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (
			(await queryRunner.hasTable('bank_imports')) &&
			(await queryRunner.hasColumn('bank_imports', 'rowsNotInBank'))
		) {
			await queryRunner.dropColumn('bank_imports', 'rowsNotInBank');
		}
		if (
			(await queryRunner.hasTable('bank_import_doubtful_rows')) &&
			(await queryRunner.hasColumn('bank_import_doubtful_rows', 'kind'))
		) {
			// Rows the owner never saw as questions would surface as doubtful rows under the previous code.
			await queryRunner.query(`DELETE FROM "bank_import_doubtful_rows" WHERE "kind" <> 'doubtful'`);
			await queryRunner.dropColumn('bank_import_doubtful_rows', 'kind');
		}
	}
}
