import {MigrationInterface, QueryRunner, Table} from 'typeorm';

const SNAPSHOTS_TABLE = 'recurring_snapshots';

export class AddRecurringSnapshots20261022120000 implements MigrationInterface {
	name = 'AddRecurringSnapshots20261022120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(SNAPSHOTS_TABLE)) return;

		await queryRunner.createTable(
			new Table({
				name: SNAPSHOTS_TABLE,
				columns: [
					{name: 'accountId', type: 'uuid', isPrimary: true},
					{name: 'inputVersion', type: 'varchar', length: '32'},
					{name: 'payload', type: 'jsonb'},
					{name: 'computedAt', type: 'timestamptz', default: 'now()'},
				],
				foreignKeys: [
					{
						columnNames: ['accountId'],
						referencedTableName: 'accounts',
						referencedColumnNames: ['id'],
						onDelete: 'CASCADE',
					},
				],
			}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(SNAPSHOTS_TABLE)) await queryRunner.dropTable(SNAPSHOTS_TABLE);
	}
}
