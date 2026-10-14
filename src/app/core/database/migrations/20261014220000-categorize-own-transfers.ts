import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * Gives existing own transfers the transfer category that the own-transfer rule now assigns: TRANSFER_IN for money in,
 * TRANSFER_OUT for money out. Manual categories and currency exchanges keep theirs. The SQL is a frozen copy of the
 * rule at the time of writing.
 */
export class CategorizeOwnTransfers20261014220000 implements MigrationInterface {
	name = 'CategorizeOwnTransfers20261014220000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasColumn('bank_transactions', 'ownTransferEvidence'))) return;

		await queryRunner.query(
			`UPDATE "bank_transactions"
			SET "category" = CASE upper("creditDebitIndicator") WHEN 'CRDT' THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END,
				"categoryStatus" = 'COMPLETED', "categorySource" = NULL, "categoryConfidence" = '1',
				"categoryProvider" = 'own-transfer', "categoryModel" = NULL,
				"categoryPromptVersion" = 'own-transfer-category-v1', "categorySearchTrace" = NULL,
				"categoryLastError" = NULL, "categoryAppliedInputHash" = "categoryInputHash", "categoryUpdatedAt" = now()
			WHERE "ownTransferEvidence" IS NOT NULL
				AND upper("creditDebitIndicator") IN ('CRDT', 'DBIT')
				AND "categorySource" IS DISTINCT FROM 'MANUAL'
				AND "financialEventType" IS NULL
				AND (
					"category" IS DISTINCT FROM CASE upper("creditDebitIndicator") WHEN 'CRDT' THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END
					OR "categoryStatus" IS DISTINCT FROM 'COMPLETED'
					OR "categorySource" IS NOT NULL
					OR "categoryProvider" IS DISTINCT FROM 'own-transfer'
				)`,
		);
	}

	public async down(): Promise<void> {
		// The previous categories were model output and are not kept; the rows stay categorized as transfers.
	}
}
