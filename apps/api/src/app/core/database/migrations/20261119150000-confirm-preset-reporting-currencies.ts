import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * A reporting currency stored before owners could choose one counts as chosen, the same as one an owner chose, so it
 * is recorded as `CONFIRMED`. Nobody is asked again and no converted amount changes.
 */
export class ConfirmPresetReportingCurrencies20261119150000 implements MigrationInterface {
	name = 'ConfirmPresetReportingCurrencies20261119150000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('accounts'))) return;
		await queryRunner.query(
			`UPDATE "accounts" SET "baseCurrencyState" = 'CONFIRMED'
			WHERE "baseCurrencyState" = 'PRESET' OR ("baseCurrencyState" IS NULL AND "baseCurrency" IS NOT NULL)`,
		);
	}

	public async down(): Promise<void> {
		// Code before this migration treats CONFIRMED as chosen too; there is nothing to restore.
	}
}
