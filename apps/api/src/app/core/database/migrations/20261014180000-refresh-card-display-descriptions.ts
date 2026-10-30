import {MigrationInterface, QueryRunner} from 'typeorm';

import {getBankTransactionDisplayDescription} from '../../../modules/banking/bank-transaction-display';

type CardDisplayRow = {
	id: string;
	description: string | null;
	counterpartyName: string | null;
	displayDescription: string;
};

/** Recomputes stored display descriptions for card lines after the card merchant parser started dropping wallet,
 * card-detail and payment-processor noise. Only rows whose value changes are written. */
export class RefreshCardDisplayDescriptions20261014180000 implements MigrationInterface {
	name = 'RefreshCardDisplayDescriptions20261014180000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		const rows = (await queryRunner.query(
			`SELECT "id", "description", "counterpartyName", "displayDescription"
			FROM "bank_transactions"
			WHERE "description" ~* '^\\s*(bea|gea),'`,
		)) as CardDisplayRow[];

		for (const row of rows) {
			const displayDescription = getBankTransactionDisplayDescription(row);
			if (displayDescription === row.displayDescription) continue;
			await queryRunner.query('UPDATE "bank_transactions" SET "displayDescription" = $1 WHERE "id" = $2', [
				displayDescription,
				row.id,
			]);
		}
	}

	public async down(): Promise<void> {
		// Display descriptions are derived; the previous parser output is not worth restoring.
	}
}
