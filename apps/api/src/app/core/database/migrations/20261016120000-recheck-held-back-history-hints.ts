import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * The first recheck of rows filled from manual history (RecheckHistoryFilledCategories20261015200000) asked the model to
 * hold back whenever a row's amount differed from the owner's examples, so purchases from specialised businesses the
 * owner had already categorised went to NEEDS_REVIEW. This sends exactly those rows back to the model with the
 * narrower instruction: rows the v7 prompt answered NEEDS_REVIEW during that recheck, for a merchant the owner has
 * manual choices for. Their category stays until the model replaces it. The SQL is a frozen copy of the markers at
 * the time of writing.
 */
export class RecheckHeldBackHistoryHints20261016120000 implements MigrationInterface {
	name = 'RecheckHeldBackHistoryHints20261016120000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`UPDATE "bank_transactions" AS t
			SET "categoryStatus" = 'PENDING', "categoryUpdatedAt" = now()
			WHERE t."categorySource" = 'AI'
				AND t."category" = 'NEEDS_REVIEW'
				AND t."categoryStatus" = 'COMPLETED'
				AND t."categoryPromptVersion" = 'bank-transaction-categorization-v7'
				AND t."categoryUpdatedAt" BETWEEN '2026-10-16T07:55:00Z' AND '2026-10-16T08:30:00Z'
				AND t."categoryInputHash" IS NOT NULL
				AND t."ownTransferEvidence" IS NULL
				AND t."financialEventType" IS NULL
				AND EXISTS (
					SELECT 1
					FROM "bank_transactions" manual
					INNER JOIN "bank_accounts" manual_account ON manual_account.id = manual."bankAccountId"
					INNER JOIN "bank_connections" manual_connection
						ON manual_connection.id = manual_account."bankConnectionId"
					INNER JOIN "bank_accounts" row_account ON row_account.id = t."bankAccountId"
					INNER JOIN "bank_connections" row_connection ON row_connection.id = row_account."bankConnectionId"
					WHERE manual."categorySource" = 'MANUAL'
						AND manual."merchantKey" = t."merchantKey"
						AND manual_connection."accountId" = row_connection."accountId"
				)`,
		);
	}

	public async down(): Promise<void> {
		// The rows keep their category until the model replaces it; there is nothing to restore.
	}
}
