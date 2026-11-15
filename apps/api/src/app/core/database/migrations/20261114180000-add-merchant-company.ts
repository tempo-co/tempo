import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class AddMerchantCompany20261114180000 implements MigrationInterface {
	name = 'AddMerchantCompany20261114180000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('merchants')) || (await queryRunner.hasColumn('merchants', 'company'))) return;
		// Identified merchants start without one; identification adds it and keeps their brand.
		await queryRunner.addColumn(
			'merchants',
			new TableColumn({name: 'company', type: 'varchar', length: '120', isNullable: true}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if ((await queryRunner.hasTable('merchants')) && (await queryRunner.hasColumn('merchants', 'company'))) {
			await queryRunner.dropColumn('merchants', 'company');
		}
	}
}
