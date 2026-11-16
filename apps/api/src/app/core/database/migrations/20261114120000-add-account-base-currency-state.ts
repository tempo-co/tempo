import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

const COLUMNS = [
	new TableColumn({name: 'baseCurrencyState', type: 'varchar', length: '16', isNullable: true}),
	new TableColumn({name: 'baseCurrencyRevision', type: 'integer', isNullable: false, default: 0}),
	new TableColumn({name: 'baseAmountsRevision', type: 'integer', isNullable: false, default: 0}),
];

/**
 * Records how each owner's reporting currency was set. A currency stored before owners could choose one is kept as it
 * is and counts as chosen (`PRESET`), so nobody is asked again and no converted amount changes.
 */
export class AddAccountBaseCurrencyState20261114120000 implements MigrationInterface {
	name = 'AddAccountBaseCurrencyState20261114120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('accounts'))) return;
		for (const column of COLUMNS) {
			if (!(await queryRunner.hasColumn('accounts', column.name)))
				await queryRunner.addColumn('accounts', column);
		}
		await queryRunner.query(
			`UPDATE "accounts" SET "baseCurrencyState" = 'PRESET'
			WHERE "baseCurrency" IS NOT NULL AND "baseCurrencyState" IS NULL`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('accounts'))) return;
		for (const column of [...COLUMNS].reverse()) {
			if (await queryRunner.hasColumn('accounts', column.name))
				await queryRunner.dropColumn('accounts', column.name);
		}
	}
}
