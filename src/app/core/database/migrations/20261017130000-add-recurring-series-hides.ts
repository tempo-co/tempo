import {MigrationInterface, QueryRunner, Table} from 'typeorm';

const HIDES_TABLE = 'recurring_series_hides';

export class AddRecurringSeriesHides20261017130000 implements MigrationInterface {
	name = 'AddRecurringSeriesHides20261017130000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(HIDES_TABLE)) return;

		await queryRunner.createTable(
			new Table({
				name: HIDES_TABLE,
				columns: [
					{
						name: 'id',
						type: 'uuid',
						isPrimary: true,
						generationStrategy: 'uuid',
						isGenerated: true,
						default: 'gen_random_uuid()',
					},
					{name: 'accountId', type: 'uuid'},
					{name: 'seriesKey', type: 'varchar', length: '32'},
					{name: 'transactionIds', type: 'uuid', isArray: true, default: "'{}'"},
					{name: 'createdAt', type: 'timestamptz', default: 'now()'},
					{name: 'updatedAt', type: 'timestamptz', default: 'now()'},
				],
				uniques: [{name: 'uq_recurring_series_hides_account_series', columnNames: ['accountId', 'seriesKey']}],
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
		if (await queryRunner.hasTable(HIDES_TABLE)) await queryRunner.dropTable(HIDES_TABLE);
	}
}
