import {MigrationInterface, QueryRunner, TableColumn, TableIndex} from 'typeorm';

import {BATCH_WRITE_CHUNK_SIZE, chunkArray} from '../../../modules/banking/banking.utils';
import {getBankTransactionMerchantKey} from '../../../modules/banking/categorization/bank-transaction-merchant-key';

const TRANSACTIONS_TABLE = 'bank_transactions';
const MERCHANT_KEY_COLUMN = 'merchantKey';
const MERCHANT_KEY_INDEX = 'idx_bank_transactions_account_merchant_key';

type MerchantKeyRow = {
	id: string;
	description: string | null;
	counterpartyName: string | null;
	creditDebitIndicator: string | null;
};

/**
 * Stores each transaction's merchant key so manual-category reuse can match in the database, and marks categories
 * that were filled from the owner's manual history with their own source.
 */
export class AddBankTransactionMerchantKey20261014200000 implements MigrationInterface {
	name = 'AddBankTransactionMerchantKey20261014200000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable(TRANSACTIONS_TABLE))) return;

		if (!(await queryRunner.hasColumn(TRANSACTIONS_TABLE, MERCHANT_KEY_COLUMN))) {
			await queryRunner.addColumn(
				TRANSACTIONS_TABLE,
				new TableColumn({name: MERCHANT_KEY_COLUMN, type: 'text', isNullable: true}),
			);
		}
		const table = await queryRunner.getTable(TRANSACTIONS_TABLE);
		if (!table?.indices.some(({name}) => name === MERCHANT_KEY_INDEX)) {
			await queryRunner.createIndex(
				TRANSACTIONS_TABLE,
				new TableIndex({name: MERCHANT_KEY_INDEX, columnNames: ['bankAccountId', MERCHANT_KEY_COLUMN]}),
			);
		}

		const rows = (await queryRunner.query(
			`SELECT "id", "description", "counterpartyName", "creditDebitIndicator" FROM "${TRANSACTIONS_TABLE}"`,
		)) as MerchantKeyRow[];
		for (const batch of chunkArray(rows, BATCH_WRITE_CHUNK_SIZE)) {
			await queryRunner.query(
				`UPDATE "${TRANSACTIONS_TABLE}" AS t
				SET "${MERCHANT_KEY_COLUMN}" = source.merchant_key
				FROM unnest($1::uuid[], $2::text[]) AS source(id, merchant_key)
				WHERE t."id" = source.id AND t."${MERCHANT_KEY_COLUMN}" IS DISTINCT FROM source.merchant_key`,
				[batch.map(({id}) => id), batch.map((row) => getBankTransactionMerchantKey(row))],
			);
		}

		// Source and provider values are frozen here on purpose; later renames must not change this migration.
		await queryRunner.query(
			`UPDATE "${TRANSACTIONS_TABLE}" SET "categorySource" = 'HISTORY'
			WHERE "categorySource" = 'AI' AND "categoryProvider" = 'manual-history'`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`UPDATE "${TRANSACTIONS_TABLE}" SET "categorySource" = 'AI' WHERE "categorySource" = 'HISTORY'`,
		);
		const table = await queryRunner.getTable(TRANSACTIONS_TABLE);
		if (table?.indices.some(({name}) => name === MERCHANT_KEY_INDEX)) {
			await queryRunner.dropIndex(TRANSACTIONS_TABLE, MERCHANT_KEY_INDEX);
		}
		if (await queryRunner.hasColumn(TRANSACTIONS_TABLE, MERCHANT_KEY_COLUMN)) {
			await queryRunner.dropColumn(TRANSACTIONS_TABLE, MERCHANT_KEY_COLUMN);
		}
	}
}
