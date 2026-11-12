import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class AddBankSyncRunFailures20261112120000 implements MigrationInterface {
	name = 'AddBankSyncRunFailures20261112120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_sync_runs'))) return;
		if (await queryRunner.hasColumn('bank_sync_runs', 'failures')) return;
		await queryRunner.addColumn(
			'bank_sync_runs',
			new TableColumn({name: 'failures', type: 'jsonb', isNullable: true}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_sync_runs'))) return;
		if (await queryRunner.hasColumn('bank_sync_runs', 'failures')) {
			await queryRunner.dropColumn('bank_sync_runs', 'failures');
		}
	}
}
