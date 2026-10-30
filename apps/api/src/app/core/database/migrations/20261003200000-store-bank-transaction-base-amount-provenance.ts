import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

const TRANSACTIONS_TABLE = 'bank_transactions';

const PROVENANCE_COLUMNS = [
	new TableColumn({name: 'baseAmountMethod', type: 'varchar', length: '16', isNullable: true}),
	new TableColumn({name: 'baseAmountRateDate', type: 'date', isNullable: true}),
];

/**
 * Stores base-currency amounts as exact cents with how they were converted. Rows already in the owner's base
 * currency keep a rounded copy; all others are cleared so the conversion job recomputes them with provenance.
 */
export class StoreBankTransactionBaseAmountProvenance20261003200000 implements MigrationInterface {
	name = 'StoreBankTransactionBaseAmountProvenance20261003200000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable(TRANSACTIONS_TABLE))) return;

		for (const column of PROVENANCE_COLUMNS) {
			if (!(await queryRunner.hasColumn(TRANSACTIONS_TABLE, column.name))) {
				await queryRunner.addColumn(TRANSACTIONS_TABLE, column);
			}
		}

		await queryRunner.query(
			`UPDATE "${TRANSACTIONS_TABLE}" AS t
			SET
				"amountInBaseCurrency" = CASE
					WHEN UPPER(BTRIM(t."currency")) = UPPER(BTRIM(account."baseCurrency")) THEN ROUND(t."amount", 2)
				END,
				"baseAmountMethod" = CASE
					WHEN UPPER(BTRIM(t."currency")) = UPPER(BTRIM(account."baseCurrency")) THEN 'SAME'
				END,
				"baseAmountRateDate" = NULL
			FROM "bank_accounts" bank_account, "bank_connections" connection, "accounts" account
			WHERE bank_account."id" = t."bankAccountId"
				AND connection."id" = bank_account."bankConnectionId"
				AND account."id" = connection."accountId"
				AND t."amountInBaseCurrency" IS NOT NULL
				AND t."baseAmountMethod" IS NULL`,
		);
		await queryRunner.query(
			`ALTER TABLE "${TRANSACTIONS_TABLE}" ALTER COLUMN "amountInBaseCurrency" TYPE numeric(30, 2)`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable(TRANSACTIONS_TABLE))) return;

		await queryRunner.query(
			`ALTER TABLE "${TRANSACTIONS_TABLE}" ALTER COLUMN "amountInBaseCurrency" TYPE numeric(30, 12)`,
		);
		for (const column of [...PROVENANCE_COLUMNS].reverse()) {
			if (await queryRunner.hasColumn(TRANSACTIONS_TABLE, column.name)) {
				await queryRunner.dropColumn(TRANSACTIONS_TABLE, column.name);
			}
		}
	}
}
