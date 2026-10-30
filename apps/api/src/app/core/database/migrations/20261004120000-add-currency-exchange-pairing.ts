import {MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex} from 'typeorm';

import {recomputeCurrencyExchanges} from '../../../modules/banking/currency-exchange/currency-exchange-recompute';

const TRANSACTIONS_TABLE = 'bank_transactions';
const COUNTERPART_COLUMN = 'currencyExchangeCounterpartId';
const COUNTERPART_INDEX = 'idx_bank_transactions_currency_exchange_counterpart';

/** Links the two legs of each currency exchange and pairs the existing history. */
export class AddCurrencyExchangePairing20261004120000 implements MigrationInterface {
	name = 'AddCurrencyExchangePairing20261004120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable(TRANSACTIONS_TABLE))) return;

		if (!(await queryRunner.hasColumn(TRANSACTIONS_TABLE, COUNTERPART_COLUMN))) {
			await queryRunner.addColumn(
				TRANSACTIONS_TABLE,
				new TableColumn({name: COUNTERPART_COLUMN, type: 'uuid', isNullable: true}),
			);
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

		const owners = (await queryRunner.query(`SELECT DISTINCT "accountId" FROM "bank_connections"`)) as Array<{
			accountId: string;
		}>;
		for (const {accountId} of owners) {
			await recomputeCurrencyExchanges(queryRunner, accountId);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable(TRANSACTIONS_TABLE))) return;

		const table = await queryRunner.getTable(TRANSACTIONS_TABLE);
		const index = table?.indices.find(({name}) => name === COUNTERPART_INDEX);
		if (index) await queryRunner.dropIndex(TRANSACTIONS_TABLE, index);
		for (const foreignKey of table?.foreignKeys.filter(({columnNames}) =>
			columnNames.includes(COUNTERPART_COLUMN),
		) ?? []) {
			await queryRunner.dropForeignKey(TRANSACTIONS_TABLE, foreignKey);
		}
		if (await queryRunner.hasColumn(TRANSACTIONS_TABLE, COUNTERPART_COLUMN)) {
			await queryRunner.dropColumn(TRANSACTIONS_TABLE, COUNTERPART_COLUMN);
		}
	}
}
