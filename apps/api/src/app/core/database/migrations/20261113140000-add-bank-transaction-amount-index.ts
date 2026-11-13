import {MigrationInterface, QueryRunner, TableIndex} from 'typeorm';

const TRANSACTIONS_TABLE = 'bank_transactions';
const AMOUNT_INDEX = 'idx_bank_transactions_account_amount';

/** Lets an own-transfer recompute read only the rows of the amounts that changed. */
export class AddBankTransactionAmountIndex20261113140000 implements MigrationInterface {
	name = 'AddBankTransactionAmountIndex20261113140000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		const table = await queryRunner.getTable(TRANSACTIONS_TABLE);
		if (!table || table.indices.some(({name}) => name === AMOUNT_INDEX)) return;
		await queryRunner.createIndex(
			TRANSACTIONS_TABLE,
			new TableIndex({name: AMOUNT_INDEX, columnNames: ['bankAccountId', 'amount']}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		const table = await queryRunner.getTable(TRANSACTIONS_TABLE);
		if (table?.indices.some(({name}) => name === AMOUNT_INDEX)) {
			await queryRunner.dropIndex(TRANSACTIONS_TABLE, AMOUNT_INDEX);
		}
	}
}
