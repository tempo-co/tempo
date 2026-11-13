import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class AddAccountTimeZone20261113120000 implements MigrationInterface {
	name = 'AddAccountTimeZone20261113120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('accounts')) || (await queryRunner.hasColumn('accounts', 'timeZone'))) return;
		// Existing accounts keep the zone every account used before accounts had their own.
		await queryRunner.addColumn(
			'accounts',
			new TableColumn({
				name: 'timeZone',
				type: 'varchar',
				length: '64',
				isNullable: false,
				default: "'Europe/Amsterdam'",
			}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if ((await queryRunner.hasTable('accounts')) && (await queryRunner.hasColumn('accounts', 'timeZone'))) {
			await queryRunner.dropColumn('accounts', 'timeZone');
		}
	}
}
