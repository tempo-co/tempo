import {MigrationInterface, QueryRunner} from 'typeorm';

import {BATCH_WRITE_CHUNK_SIZE, chunkArray} from '../../../modules/banking/banking.utils';
import {getBankTransactionMerchantKey} from '../../../modules/banking/categorization/bank-transaction-merchant-key';

type MerchantKeyRow = {
	id: string;
	description: string | null;
	counterpartyName: string | null;
	creditDebitIndicator: string | null;
};

/** Refreshes derived keys after transfer prefixes and accents became formatting rather than payee identity. */
export class RefreshBankTransactionMerchantKeysForTransferPayees20261023230000 implements MigrationInterface {
	name = 'RefreshBankTransactionMerchantKeysForTransferPayees20261023230000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasColumn('bank_transactions', 'merchantKey'))) return;

		const rows = (await queryRunner.query(
			`SELECT "id", "description", "counterpartyName", "creditDebitIndicator" FROM "bank_transactions"`,
		)) as MerchantKeyRow[];
		for (const batch of chunkArray(rows, BATCH_WRITE_CHUNK_SIZE)) {
			await queryRunner.query(
				`UPDATE "bank_transactions" AS t
				SET "merchantKey" = source.merchant_key
				FROM unnest($1::uuid[], $2::text[]) AS source(id, merchant_key)
				WHERE t."id" = source.id AND t."merchantKey" IS DISTINCT FROM source.merchant_key`,
				[batch.map(({id}) => id), batch.map((row) => getBankTransactionMerchantKey(row))],
			);
		}
	}

	public async down(): Promise<void> {
		// Keys are derived from retained source fields; categories and transaction timestamps are unchanged.
	}
}
