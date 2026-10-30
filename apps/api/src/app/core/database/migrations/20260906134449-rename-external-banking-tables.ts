import {MigrationInterface, QueryRunner} from 'typeorm';

export class RenameExternalBankingTables20260906134449 implements MigrationInterface {
	name = 'RenameExternalBankingTables20260906134449';

	public async up(queryRunner: QueryRunner): Promise<void> {
		const hasExternalTables = await queryRunner.hasTable('external_transactions');
		if (!hasExternalTables) {
			return;
		}
		await queryRunner.renameTable('external_transactions', 'bank_transactions');
		await queryRunner.renameTable('external_account_balances', 'bank_account_balances');
		await queryRunner.renameTable('external_accounts', 'bank_accounts');

		await queryRunner.renameColumn('bank_account_balances', 'externalAccountId', 'bankAccountId');
		await queryRunner.renameColumn('bank_transactions', 'externalAccountId', 'bankAccountId');

		await this.renameIndex(
			queryRunner,
			'idx_external_accounts_connection_identification_hash',
			'idx_bank_accounts_connection_identification_hash',
		);
		await this.renameIndex(
			queryRunner,
			'idx_external_accounts_connection_provider_account_id',
			'idx_bank_accounts_connection_provider_account_id',
		);
		await this.renameIndex(
			queryRunner,
			'idx_external_account_balances_account_observed_at',
			'idx_bank_account_balances_account_observed_at',
		);
		await this.renameIndex(
			queryRunner,
			'idx_external_account_balances_sync_run_account',
			'idx_bank_account_balances_sync_run_account',
		);
		await this.renameIndex(
			queryRunner,
			'idx_external_transactions_account_dedupe',
			'idx_bank_transactions_account_dedupe',
		);
		await this.renameIndex(
			queryRunner,
			'idx_external_transactions_account_booking_date',
			'idx_bank_transactions_account_booking_date',
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await this.renameIndex(
			queryRunner,
			'idx_bank_transactions_account_booking_date',
			'idx_external_transactions_account_booking_date',
		);
		await this.renameIndex(
			queryRunner,
			'idx_bank_transactions_account_dedupe',
			'idx_external_transactions_account_dedupe',
		);
		await this.renameIndex(
			queryRunner,
			'idx_bank_account_balances_sync_run_account',
			'idx_external_account_balances_sync_run_account',
		);
		await this.renameIndex(
			queryRunner,
			'idx_bank_account_balances_account_observed_at',
			'idx_external_account_balances_account_observed_at',
		);
		await this.renameIndex(
			queryRunner,
			'idx_bank_accounts_connection_provider_account_id',
			'idx_external_accounts_connection_provider_account_id',
		);
		await this.renameIndex(
			queryRunner,
			'idx_bank_accounts_connection_identification_hash',
			'idx_external_accounts_connection_identification_hash',
		);

		await queryRunner.renameColumn('bank_account_balances', 'bankAccountId', 'externalAccountId');
		await queryRunner.renameColumn('bank_transactions', 'bankAccountId', 'externalAccountId');

		await queryRunner.renameTable('bank_accounts', 'external_accounts');
		await queryRunner.renameTable('bank_account_balances', 'external_account_balances');
		await queryRunner.renameTable('bank_transactions', 'external_transactions');
	}

	private renameIndex(queryRunner: QueryRunner, currentName: string, newName: string): Promise<void> {
		return queryRunner.query(`ALTER INDEX "${currentName}" RENAME TO "${newName}"`);
	}
}
