import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

const ALERT_MARKER_COLUMNS = ['consentExpiringAlertFor', 'consentFinalAlertFor', 'syncAlertFor'];

export class AddBankConnectionAlertMarkers20261016230000 implements MigrationInterface {
	name = 'AddBankConnectionAlertMarkers20261016230000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_connections'))) return;

		for (const name of ALERT_MARKER_COLUMNS) {
			if (await queryRunner.hasColumn('bank_connections', name)) continue;
			await queryRunner.addColumn(
				'bank_connections',
				new TableColumn({name, type: 'timestamptz', isNullable: true}),
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_connections'))) return;

		for (const name of ALERT_MARKER_COLUMNS) {
			if (await queryRunner.hasColumn('bank_connections', name)) {
				await queryRunner.dropColumn('bank_connections', name);
			}
		}
	}
}
