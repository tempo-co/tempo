import {MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex} from 'typeorm';

import {parseSepaDescriptionIban} from '../../../modules/banking/own-transfer/iban';
import {recomputeOwnTransfers} from '../../../modules/banking/own-transfer/own-transfer-recompute';

const ACCOUNTS_TABLE = 'bank_accounts';
const TRANSACTIONS_TABLE = 'bank_transactions';
const COUNTERPART_COLUMN = 'ownTransferCounterpartId';
const COUNTERPART_INDEX = 'idx_bank_transactions_own_transfer_counterpart';
const UPDATE_BATCH_SIZE = 500;

const TRANSACTION_COLUMNS = [
	new TableColumn({name: 'counterpartyIban', type: 'varchar', length: '34', isNullable: true}),
	new TableColumn({name: 'ownTransferEvidence', type: 'varchar', length: '16', isNullable: true}),
	new TableColumn({name: COUNTERPART_COLUMN, type: 'uuid', isNullable: true}),
	new TableColumn({name: 'ownTransferOverride', type: 'varchar', length: '16', isNullable: true}),
];

export class AddOwnTransferRecognition20261001120000 implements MigrationInterface {
	name = 'AddOwnTransferRecognition20261001120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable(ACCOUNTS_TABLE)) || !(await queryRunner.hasTable(TRANSACTIONS_TABLE))) return;

		if (!(await queryRunner.hasColumn(ACCOUNTS_TABLE, 'iban'))) {
			await queryRunner.addColumn(
				ACCOUNTS_TABLE,
				new TableColumn({name: 'iban', type: 'varchar', length: '34', isNullable: true}),
			);
		}
		for (const column of TRANSACTION_COLUMNS) {
			if (!(await queryRunner.hasColumn(TRANSACTIONS_TABLE, column.name))) {
				await queryRunner.addColumn(TRANSACTIONS_TABLE, column);
			}
		}

		const table = await queryRunner.getTable(TRANSACTIONS_TABLE);
		if (!table?.foreignKeys.some(({columnNames}) => columnNames.includes(COUNTERPART_COLUMN))) {
			await queryRunner.createForeignKey(
				TRANSACTIONS_TABLE,
				new TableForeignKey({
					columnNames: [COUNTERPART_COLUMN],
					referencedTableName: TRANSACTIONS_TABLE,
					referencedColumnNames: ['id'],
					onDelete: 'SET NULL',
				}),
			);
		}
		if (!table?.indices.some(({name}) => name === COUNTERPART_INDEX)) {
			await queryRunner.createIndex(
				TRANSACTIONS_TABLE,
				new TableIndex({name: COUNTERPART_INDEX, columnNames: [COUNTERPART_COLUMN]}),
			);
		}

		await backfillCounterpartyIbans(queryRunner);

		const owners = (await queryRunner.query(`SELECT DISTINCT "accountId" FROM "bank_connections"`)) as Array<{
			accountId: string;
		}>;
		for (const {accountId} of owners) {
			await recomputeOwnTransfers(queryRunner, accountId);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (await queryRunner.hasTable(TRANSACTIONS_TABLE)) {
			const table = await queryRunner.getTable(TRANSACTIONS_TABLE);
			const index = table?.indices.find(({name}) => name === COUNTERPART_INDEX);
			if (index) await queryRunner.dropIndex(TRANSACTIONS_TABLE, index);
			for (const foreignKey of table?.foreignKeys.filter(({columnNames}) =>
				columnNames.includes(COUNTERPART_COLUMN),
			) ?? []) {
				await queryRunner.dropForeignKey(TRANSACTIONS_TABLE, foreignKey);
			}
			for (const column of [...TRANSACTION_COLUMNS].reverse()) {
				if (await queryRunner.hasColumn(TRANSACTIONS_TABLE, column.name)) {
					await queryRunner.dropColumn(TRANSACTIONS_TABLE, column.name);
				}
			}
		}
		if ((await queryRunner.hasTable(ACCOUNTS_TABLE)) && (await queryRunner.hasColumn(ACCOUNTS_TABLE, 'iban'))) {
			await queryRunner.dropColumn(ACCOUNTS_TABLE, 'iban');
		}
	}
}

async function backfillCounterpartyIbans(queryRunner: QueryRunner): Promise<void> {
	const rows = (await queryRunner.query(
		`SELECT "id", "description" FROM "${TRANSACTIONS_TABLE}"
		WHERE "counterpartyIban" IS NULL AND "description" ~* '^\\s*SEPA.*IBAN:'
		ORDER BY "id"`,
	)) as Array<{id: string; description: string}>;
	const updates = rows.flatMap(({id, description}) => {
		const iban = parseSepaDescriptionIban(description);
		return iban ? [{id, iban}] : [];
	});

	for (let offset = 0; offset < updates.length; offset += UPDATE_BATCH_SIZE) {
		const batch = updates.slice(offset, offset + UPDATE_BATCH_SIZE);
		const values = batch.map((_, index) => `($${index * 2 + 1}::uuid, $${index * 2 + 2})`);
		await queryRunner.query(
			`UPDATE "${TRANSACTIONS_TABLE}" AS transaction SET "counterpartyIban" = backfill."iban"
			FROM (VALUES ${values.join(', ')}) AS backfill("id", "iban")
			WHERE transaction."id" = backfill."id"`,
			batch.flatMap(({id, iban}) => [id, iban]),
		);
	}
}
