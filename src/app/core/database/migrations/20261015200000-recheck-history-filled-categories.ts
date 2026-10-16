import {MigrationInterface, QueryRunner} from 'typeorm';

/**
 * Sends rows that were filled from the owner's manual history automatically back to the model. A manual choice is
 * now only a hint, so these rows get a fresh classification with that hint. Their category stays while the model
 * runs, and also if the model call fails; the startup reconciliation enqueues them.
 *
 * Rows the owner selected in a correction preview are kept. Until this release both paths wrote the same markers, so
 * a preview-confirmed row is recognised by a manual correction for the same merchant and owner shortly before it: the
 * follow-up runs in the same request, and a queued retry within about twenty minutes. Before the preview shipped,
 * every history row was automatic. The SQL is a frozen copy of the markers at the time of writing.
 */
export class RecheckHistoryFilledCategories20261015200000 implements MigrationInterface {
	name = 'RecheckHistoryFilledCategories20261015200000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`UPDATE "bank_transactions" AS t
			SET "categoryStatus" = 'PENDING', "categoryUpdatedAt" = now()
			WHERE t."categorySource" = 'HISTORY'
				AND t."categoryPromptVersion" = 'bank-transaction-manual-history-v1'
				AND t."categoryStatus" = 'COMPLETED'
				AND t."categoryInputHash" IS NOT NULL
				AND t."ownTransferEvidence" IS NULL
				AND t."financialEventType" IS NULL
				AND (
					t."categoryUpdatedAt" < '2026-10-15T15:40:00Z'
					OR NOT EXISTS (
						SELECT 1
						FROM "bank_transactions" manual
						INNER JOIN "bank_accounts" manual_account ON manual_account.id = manual."bankAccountId"
						INNER JOIN "bank_connections" manual_connection
							ON manual_connection.id = manual_account."bankConnectionId"
						INNER JOIN "bank_accounts" row_account ON row_account.id = t."bankAccountId"
						INNER JOIN "bank_connections" row_connection
							ON row_connection.id = row_account."bankConnectionId"
						WHERE manual."categorySource" = 'MANUAL'
							AND manual."merchantKey" = t."merchantKey"
							AND manual_connection."accountId" = row_connection."accountId"
							AND manual."categoryUpdatedAt" BETWEEN t."categoryUpdatedAt" - interval '30 minutes'
								AND t."categoryUpdatedAt"
					)
				)`,
		);
	}

	public async down(): Promise<void> {
		// The rows keep their category until the model replaces it; there is nothing to restore.
	}
}
