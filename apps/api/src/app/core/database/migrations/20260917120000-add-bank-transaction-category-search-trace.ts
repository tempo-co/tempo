import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class AddBankTransactionCategorySearchTrace20260917120000 implements MigrationInterface {
	name = 'AddBankTransactionCategorySearchTrace20260917120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		if (await queryRunner.hasColumn('bank_transactions', 'categorySearchTrace')) return;

		await queryRunner.addColumn(
			'bank_transactions',
			new TableColumn({
				name: 'categorySearchTrace',
				type: 'jsonb',
				isNullable: true,
			}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		if (await queryRunner.hasColumn('bank_transactions', 'categorySearchTrace')) {
			await queryRunner.dropColumn('bank_transactions', 'categorySearchTrace');
		}
	}
}
