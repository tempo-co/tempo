import {MigrationInterface, QueryRunner, Table} from 'typeorm';

const CHOICES_TABLE = 'recurring_continuation_choices';

export class AddRecurringContinuationChoices20261021120000 implements MigrationInterface {
	name = 'AddRecurringContinuationChoices20261021120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(CHOICES_TABLE)) return;

		await queryRunner.createTable(
			new Table({
				name: CHOICES_TABLE,
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
					{name: 'choice', type: 'varchar', length: '16'},
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
		if (await queryRunner.hasTable(CHOICES_TABLE)) await queryRunner.dropTable(CHOICES_TABLE);
	}
}
