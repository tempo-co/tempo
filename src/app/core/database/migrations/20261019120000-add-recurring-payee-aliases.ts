import {MigrationInterface, QueryRunner, Table} from 'typeorm';

const ALIASES_TABLE = 'recurring_payee_aliases';

export class AddRecurringPayeeAliases20261019120000 implements MigrationInterface {
	name = 'AddRecurringPayeeAliases20261019120000';

	async up(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(ALIASES_TABLE)) return;
		await queryRunner.createTable(
			new Table({
				name: ALIASES_TABLE,
				checks: [
					{
						name: 'chk_recurring_payee_aliases_category',
						expression: `"category" IN ('HOUSING_AND_UTILITIES', 'FOOD_AND_DRINK', 'TRANSPORTATION', 'SHOPPING', 'SUBSCRIPTIONS', 'HEALTH', 'TRAVEL', 'ENTERTAINMENT', 'PERSONAL_CARE', 'EDUCATION', 'INSURANCE', 'FEES', 'CASH_WITHDRAWAL', 'INCOME', 'REFUND', 'TRANSFER_IN', 'TRANSFER_OUT', 'NEEDS_REVIEW', 'OTHER')`,
					},
				],
				columns: [
					{
						name: 'id',
						type: 'uuid',
						isPrimary: true,
						isGenerated: true,
						generationStrategy: 'uuid',
						default: 'gen_random_uuid()',
					},
					{name: 'accountId', type: 'uuid'},
					{name: 'merchantKey', type: 'text'},
					{name: 'category', type: 'varchar', length: '32'},
					{name: 'payeeGroupId', type: 'uuid'},
					{name: 'createdAt', type: 'timestamptz', default: 'now()'},
					{name: 'updatedAt', type: 'timestamptz', default: 'now()'},
				],
				uniques: [
					{
						name: 'uq_recurring_payee_aliases_account_merchant_category',
						columnNames: ['accountId', 'merchantKey', 'category'],
					},
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

	async down(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(ALIASES_TABLE)) await queryRunner.dropTable(ALIASES_TABLE);
	}
}
