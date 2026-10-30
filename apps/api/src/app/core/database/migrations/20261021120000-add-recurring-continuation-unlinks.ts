import {MigrationInterface, QueryRunner, Table} from 'typeorm';

const UNLINKS_TABLE = 'recurring_continuation_unlinks';

export class AddRecurringContinuationUnlinks20261021120000 implements MigrationInterface {
	name = 'AddRecurringContinuationUnlinks20261021120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(UNLINKS_TABLE)) return;

		await queryRunner.createTable(
			new Table({
				name: UNLINKS_TABLE,
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
					{name: 'olderTransactionIds', type: 'uuid', isArray: true},
					{name: 'newerTransactionIds', type: 'uuid', isArray: true},
					{name: 'createdAt', type: 'timestamptz', default: 'now()'},
					{name: 'updatedAt', type: 'timestamptz', default: 'now()'},
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
		if (await queryRunner.hasTable(UNLINKS_TABLE)) await queryRunner.dropTable(UNLINKS_TABLE);
	}
}
