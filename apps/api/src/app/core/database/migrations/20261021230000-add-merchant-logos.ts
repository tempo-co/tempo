import {MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex} from 'typeorm';

const LOGOS_TABLE = 'merchant_logos';
const MERCHANTS_TABLE = 'merchants';

export class AddMerchantLogos20261021230000 implements MigrationInterface {
	name = 'AddMerchantLogos20261021230000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('accounts'))) return;

		if (!(await queryRunner.hasTable(LOGOS_TABLE))) {
			await queryRunner.createTable(
				new Table({
					name: LOGOS_TABLE,
					columns: [
						{
							name: 'id',
							type: 'uuid',
							isPrimary: true,
							generationStrategy: 'uuid',
							isGenerated: true,
							default: 'gen_random_uuid()',
						},
						{name: 'domain', type: 'varchar', length: '253'},
						{name: 'status', type: 'varchar', length: '16', default: "'PENDING'"},
						{name: 'siteNames', type: 'jsonb', default: "'[]'"},
						{name: 'image', type: 'bytea', isNullable: true},
						{name: 'version', type: 'varchar', length: '64', isNullable: true},
						{name: 'sourceUrl', type: 'text', isNullable: true},
						{name: 'sourceSize', type: 'int', isNullable: true},
						{name: 'homepageLoaded', type: 'boolean', default: false},
						{name: 'monochrome', type: 'boolean', default: false},
						{name: 'attempts', type: 'int', default: 0},
						{name: 'retryAfter', type: 'timestamptz', isNullable: true},
						{name: 'fetchedAt', type: 'timestamptz', isNullable: true},
						{name: 'createdAt', type: 'timestamptz', default: 'now()'},
						{name: 'updatedAt', type: 'timestamptz', default: 'now()'},
					],
					indices: [
						new TableIndex({name: 'idx_merchant_logos_domain', columnNames: ['domain'], isUnique: true}),
					],
				}),
				true,
			);
		}

		if (!(await queryRunner.hasTable(MERCHANTS_TABLE))) {
			await queryRunner.createTable(
				new Table({
					name: MERCHANTS_TABLE,
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
						{name: 'key', type: 'text'},
						{name: 'status', type: 'varchar', length: '16', default: "'PENDING'"},
						{name: 'brand', type: 'varchar', length: '120', isNullable: true},
						{name: 'domain', type: 'varchar', length: '253', isNullable: true},
						{name: 'domainConfident', type: 'boolean', default: false},
						{name: 'logoId', type: 'uuid', isNullable: true},
						{name: 'attempts', type: 'int', default: 0},
						{name: 'retryAfter', type: 'timestamptz', isNullable: true},
						{name: 'createdAt', type: 'timestamptz', default: 'now()'},
						{name: 'updatedAt', type: 'timestamptz', default: 'now()'},
					],
					indices: [
						new TableIndex({
							name: 'idx_merchants_account_key',
							columnNames: ['accountId', 'key'],
							isUnique: true,
						}),
					],
					foreignKeys: [
						new TableForeignKey({
							columnNames: ['accountId'],
							referencedTableName: 'accounts',
							referencedColumnNames: ['id'],
							onDelete: 'CASCADE',
						}),
						new TableForeignKey({
							columnNames: ['logoId'],
							referencedTableName: LOGOS_TABLE,
							referencedColumnNames: ['id'],
							onDelete: 'SET NULL',
						}),
					],
				}),
				true,
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(MERCHANTS_TABLE)) await queryRunner.dropTable(MERCHANTS_TABLE, true, true, true);
		if (await queryRunner.hasTable(LOGOS_TABLE)) await queryRunner.dropTable(LOGOS_TABLE, true, true, true);
	}
}
