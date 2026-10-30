import {MigrationInterface, QueryRunner} from 'typeorm';

import {extractProcessorCollectedBusinessName} from '../../../modules/banking/bank-transaction-display';
import {deriveBankTransactionTextColumns} from '../../../modules/banking/bank-transaction-text-columns';

type CollectedBusinessRow = {
	id: string;
	description: string;
	counterpartyName: string | null;
	creditDebitIndicator: string | null;
};

/** Refreshes only derived identity backed by explicit business evidence in a processor-collected direct debit. */
export class RefreshProcessorCollectedBusinessIdentity20261026120000 implements MigrationInterface {
	name = 'RefreshProcessorCollectedBusinessIdentity20261026120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		const rows = (await queryRunner.query(
			`SELECT "id", "description", "counterpartyName", "creditDebitIndicator"
			FROM "bank_transactions" WHERE "description" ILIKE '%incasso%'`,
		)) as CollectedBusinessRow[];
		for (const row of rows) {
			if (!extractProcessorCollectedBusinessName(row)) continue;
			const {merchantKey, displayDescription} = deriveBankTransactionTextColumns(row);
			await queryRunner.query(
				`UPDATE "bank_transactions" SET "merchantKey" = $1, "displayDescription" = $2
				WHERE "id" = $3 AND ("merchantKey" IS DISTINCT FROM $1 OR "displayDescription" IS DISTINCT FROM $2)`,
				[merchantKey, displayDescription, row.id],
			);
		}
	}

	public async down(): Promise<void> {
		// Both columns are derived from retained source text; do not restore obsolete processor-only identity.
	}
}
