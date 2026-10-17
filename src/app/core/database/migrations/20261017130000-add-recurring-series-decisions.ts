import {MigrationInterface, QueryRunner, Table} from 'typeorm';

const DECISIONS_TABLE = 'recurring_series_decisions';

export class AddRecurringSeriesDecisions20261017130000 implements MigrationInterface {
	name = 'AddRecurringSeriesDecisions20261017130000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(DECISIONS_TABLE)) return;

		await queryRunner.createTable(
			new Table({
				name: DECISIONS_TABLE,
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
					{name: 'decision', type: 'varchar', length: '16'},
					{name: 'transactionIds', type: 'uuid', isArray: true, default: "'{}'"},
					{name: 'createdAt', type: 'timestamptz', default: 'now()'},
					{name: 'updatedAt', type: 'timestamptz', default: 'now()'},
				],
				uniques: [
					{name: 'uq_recurring_series_decisions_account_series', columnNames: ['accountId', 'seriesKey']},
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
		if (await queryRunner.hasTable(DECISIONS_TABLE)) await queryRunner.dropTable(DECISIONS_TABLE);
	}
}
