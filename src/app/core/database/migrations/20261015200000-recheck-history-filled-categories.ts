import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * Sends rows that were filled from the owner's manual history automatically back to the model. A manual choice is
 * now only a hint, so these rows get a fresh classification with that hint. Their category stays until the model
 * replaces it; the startup reconciliation enqueues them. At the time of writing no history row came from a correction
 * the owner confirmed in the preview, so every history row is rechecked.
 */
export class RecheckHistoryFilledCategories20261015200000 implements MigrationInterface {
	name = 'RecheckHistoryFilledCategories20261015200000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`UPDATE "bank_transactions"
			SET "categoryStatus" = 'PENDING', "categoryUpdatedAt" = now()
			WHERE "categorySource" = 'HISTORY'
				AND "categoryStatus" = 'COMPLETED'
				AND "categoryInputHash" IS NOT NULL
				AND "ownTransferEvidence" IS NULL
				AND "financialEventType" IS NULL`,
		);
	}

	public async down(): Promise<void> {
		// The rows keep their category until the model replaces it; there is nothing to restore.
	}
}
