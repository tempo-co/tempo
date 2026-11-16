import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

/** Imports count the rows a later sync removed, and keep each one's owner edits to restore when it is added back. */
export class AddBankImportRowsRemovedBySync20261116090000 implements MigrationInterface {
	name = 'AddBankImportRowsRemovedBySync20261116090000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (
			(await queryRunner.hasTable('bank_imports')) &&
			!(await queryRunner.hasColumn('bank_imports', 'rowsRemovedBySync'))
		) {
			await queryRunner.addColumn(
				'bank_imports',
				new TableColumn({name: 'rowsRemovedBySync', type: 'integer', isNullable: false, default: 0}),
			);
		}
		if (
			(await queryRunner.hasTable('bank_import_doubtful_rows')) &&
			!(await queryRunner.hasColumn('bank_import_doubtful_rows', 'ownerEdits'))
		) {
			await queryRunner.addColumn(
				'bank_import_doubtful_rows',
				new TableColumn({name: 'ownerEdits', type: 'jsonb', isNullable: true}),
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (
			(await queryRunner.hasTable('bank_import_doubtful_rows')) &&
			(await queryRunner.hasColumn('bank_import_doubtful_rows', 'ownerEdits'))
		) {
			// The previous code lists only rows the import never added; removed rows would sit unseen.
			await queryRunner.query(`DELETE FROM "bank_import_doubtful_rows" WHERE "kind" = 'removed_by_sync'`);
			await queryRunner.dropColumn('bank_import_doubtful_rows', 'ownerEdits');
		}
		if (
			(await queryRunner.hasTable('bank_imports')) &&
			(await queryRunner.hasColumn('bank_imports', 'rowsRemovedBySync'))
		) {
			await queryRunner.dropColumn('bank_imports', 'rowsRemovedBySync');
		}
	}
}
