import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

/**
 * Imported rows record the scheme their statement numbered them in, so another format's references can be told apart.
 * Rows of an import of one format and layout take its numbering; rows of a drop of several stay unknown.
 */
export class AddBankTransactionStatementNumbering20261118090000 implements MigrationInterface {
	name = 'AddBankTransactionStatementNumbering20261118090000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		if (!(await queryRunner.hasColumn('bank_transactions', 'statementNumbering'))) {
			await queryRunner.addColumn(
				'bank_transactions',
				new TableColumn({name: 'statementNumbering', type: 'varchar', length: '96', isNullable: true}),
			);
		}
		if (!(await queryRunner.hasTable('bank_imports'))) return;
		await queryRunner.query(`
			UPDATE "bank_transactions" bank_transaction
			SET "statementNumbering" = CASE
				WHEN bank_import."layout" IS NULL THEN bank_import."format"
				ELSE bank_import."format" || ':' || bank_import."layout"
			END
			FROM "bank_imports" bank_import
			WHERE bank_transaction."importId" = bank_import."id"
				AND bank_import."format" <> 'mixed'
				AND bank_transaction."statementNumbering" IS NULL
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		if (await queryRunner.hasColumn('bank_transactions', 'statementNumbering')) {
			await queryRunner.dropColumn('bank_transactions', 'statementNumbering');
		}
	}
}
