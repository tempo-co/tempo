import {MigrationInterface, QueryRunner} from 'typeorm';

import {deriveBankTransactionTextColumns} from '../../../modules/banking/bank-transaction-text-columns';
import {isAccountHolderName} from '../../../modules/banking/own-transfer/own-transfer-detection';

type CounterpartyRow = {
	id: string;
	description: string | null;
	counterpartyName: string;
	creditDebitIndicator: string | null;
	remittanceInformation: string | null;
	bankTransactionDescription: string | null;
	ownTransferEvidence: string | null;
	holderName: string | null;
};

/**
 * Brings stored counterparty text in line with the provider client, which takes the name only from the party the
 * direction names and no longer copies it into the description. The provider payload is not stored, so a name that
 * came from the wrong party is recognized by what it was: the account's own holder name on a row that is not an own
 * transfer (for which the holder is the real other party), or any name on a row without a known direction. A
 * description that is a copy of the name (no remittance or bank code text to come from) is cleared as well. The
 * display description and merchant key are derived again; categories, own-transfer and owner data stay as they are.
 */
export class ClearAccountHolderCounterpartyNames20261113130000 implements MigrationInterface {
	name = 'ClearAccountHolderCounterpartyNames20261113130000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		const rows = (await queryRunner.query(
			`SELECT t."id", t."description", t."counterpartyName", t."creditDebitIndicator", t."remittanceInformation",
				t."bankTransactionDescription", t."ownTransferEvidence", a."name" AS "holderName"
			FROM "bank_transactions" t JOIN "bank_accounts" a ON a."id" = t."bankAccountId"
			WHERE t."counterpartyName" IS NOT NULL`,
		)) as CounterpartyRow[];
		for (const row of rows) {
			const direction = row.creditDebitIndicator?.trim().toUpperCase();
			const wrongParty =
				(direction !== 'DBIT' && direction !== 'CRDT') ||
				(row.ownTransferEvidence === null && isAccountHolderName(row.counterpartyName, [row.holderName]));
			const copiedDescription =
				row.description === row.counterpartyName &&
				row.remittanceInformation === null &&
				row.bankTransactionDescription === null;
			if (!wrongParty && !copiedDescription) continue;

			const counterpartyName = wrongParty ? null : row.counterpartyName;
			const description = copiedDescription ? null : row.description;
			const {displayDescription, merchantKey} = deriveBankTransactionTextColumns({
				description,
				counterpartyName,
				creditDebitIndicator: row.creditDebitIndicator,
			});
			await queryRunner.query(
				`UPDATE "bank_transactions"
				SET "counterpartyName" = $1, "description" = $2, "displayDescription" = $3, "merchantKey" = $4
				WHERE "id" = $5`,
				[counterpartyName, description, displayDescription, merchantKey, row.id],
			);
		}
	}

	public async down(): Promise<void> {
		// The cleared values were the account holder's name or a copy of the counterparty; nothing to restore.
	}
}
