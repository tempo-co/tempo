import {MigrationInterface, QueryRunner, TableColumn, TableIndex} from 'typeorm';

const SYNC_COLUMNS = [
	new TableColumn({
		name: 'nextSyncAt',
		type: 'timestamptz',
		isNullable: true,
	}),
	new TableColumn({
		name: 'syncStartedAt',
		type: 'timestamptz',
		isNullable: true,
	}),
	new TableColumn({
		name: 'syncStatus',
		type: 'varchar',
		length: '32',
		default: "'IDLE'",
		isNullable: false,
	}),
	new TableColumn({
		name: 'syncFailureCount',
		type: 'integer',
		default: '0',
		isNullable: false,
	}),
];

const SYNC_INDEX_NAME = 'idx_bank_connections_sync_due';

export class AddBankConnectionSyncScheduling20260918130422 implements MigrationInterface {
	name = 'AddBankConnectionSyncScheduling20260918130422';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_connections'))) return;

		for (const column of SYNC_COLUMNS) {
			if (!(await queryRunner.hasColumn('bank_connections', column.name))) {
				await queryRunner.addColumn('bank_connections', column);
			}
		}

		const table = await queryRunner.getTable('bank_connections');
		if (table && !table.indices.some((index) => index.name === SYNC_INDEX_NAME)) {
			await queryRunner.createIndex(
				'bank_connections',
				new TableIndex({name: SYNC_INDEX_NAME, columnNames: ['status', 'nextSyncAt']}),
			);
		}

		await queryRunner.query(`
			UPDATE "bank_connections"
			SET "nextSyncAt" = CASE
				WHEN "status" = 'AUTHORIZED' AND "lastSyncedAt" IS NULL THEN NOW()
				WHEN "status" = 'AUTHORIZED' THEN "lastSyncedAt" + INTERVAL '6 hours'
				ELSE NULL
			END,
			"syncStatus" = CASE
				WHEN "status" = 'AUTHORIZED' AND "lastSyncedAt" IS NULL THEN 'QUEUED'
				WHEN "status" = 'AUTHORIZED' THEN 'SUCCEEDED'
				ELSE 'IDLE'
			END,
			"syncFailureCount" = 0
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_connections'))) return;

		const table = await queryRunner.getTable('bank_connections');
		const syncIndex = table?.indices.find((index) => index.name === SYNC_INDEX_NAME);
		if (syncIndex) await queryRunner.dropIndex('bank_connections', syncIndex);

		for (const column of [...SYNC_COLUMNS].reverse()) {
			if (await queryRunner.hasColumn('bank_connections', column.name)) {
				await queryRunner.dropColumn('bank_connections', column.name);
			}
		}
	}
}
