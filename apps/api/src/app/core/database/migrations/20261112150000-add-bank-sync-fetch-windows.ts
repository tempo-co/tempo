import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class AddBankSyncFetchWindows20261112150000 implements MigrationInterface {
	name = 'AddBankSyncFetchWindows20261112150000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (
			(await queryRunner.hasTable('bank_accounts')) &&
			!(await queryRunner.hasColumn('bank_accounts', 'transactionsFetchedThrough'))
		) {
			await queryRunner.addColumn(
				'bank_accounts',
				new TableColumn({name: 'transactionsFetchedThrough', type: 'date', isNullable: true}),
			);
			// An active account that existed when its connection last fully succeeded was fetched through that run.
			// Everything else starts unfetched and gets the provider's longest history once.
			await queryRunner.query(`
				UPDATE "bank_accounts" AS account
				SET "transactionsFetchedThrough" = latest."requestedTo"
				FROM (
					SELECT acc."id" AS "bankAccountId", MAX(run."requestedTo") AS "requestedTo"
					FROM "bank_accounts" AS acc
					JOIN "bank_sync_runs" AS run
						ON run."bankConnectionId" = acc."bankConnectionId"
						AND run."status" = 'SUCCEEDED'
						AND run."startedAt" >= acc."createdAt"
					WHERE acc."isActive" = true
					GROUP BY acc."id"
				) AS latest
				WHERE account."id" = latest."bankAccountId" AND latest."requestedTo" IS NOT NULL
			`);
		}
		if (
			(await queryRunner.hasTable('bank_connections')) &&
			!(await queryRunner.hasColumn('bank_connections', 'syncRetryCalls'))
		) {
			await queryRunner.addColumn(
				'bank_connections',
				new TableColumn({name: 'syncRetryCalls', type: 'jsonb', isNullable: true}),
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (
			(await queryRunner.hasTable('bank_connections')) &&
			(await queryRunner.hasColumn('bank_connections', 'syncRetryCalls'))
		) {
			await queryRunner.dropColumn('bank_connections', 'syncRetryCalls');
		}
		if (
			(await queryRunner.hasTable('bank_accounts')) &&
			(await queryRunner.hasColumn('bank_accounts', 'transactionsFetchedThrough'))
		) {
			await queryRunner.dropColumn('bank_accounts', 'transactionsFetchedThrough');
		}
	}
}
