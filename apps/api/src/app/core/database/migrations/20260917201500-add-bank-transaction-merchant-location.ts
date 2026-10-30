import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class AddBankTransactionMerchantLocation20260917201500 implements MigrationInterface {
	name = 'AddBankTransactionMerchantLocation20260917201500';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		if (await queryRunner.hasColumn('bank_transactions', 'merchantLocation')) return;

		await queryRunner.addColumn(
			'bank_transactions',
			new TableColumn({
				name: 'merchantLocation',
				type: 'jsonb',
				isNullable: true,
			}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;
		if (await queryRunner.hasColumn('bank_transactions', 'merchantLocation')) {
			await queryRunner.dropColumn('bank_transactions', 'merchantLocation');
		}
	}
}
