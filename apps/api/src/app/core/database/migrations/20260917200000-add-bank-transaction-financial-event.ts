import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

const FINANCIAL_EVENT_COLUMNS = [
	new TableColumn({
		name: 'financialEventType',
		type: 'varchar',
		length: '32',
		isNullable: true,
	}),
	new TableColumn({
		name: 'financialEventSource',
		type: 'varchar',
		length: '16',
		isNullable: true,
	}),
	new TableColumn({
		name: 'financialEventRuleVersion',
		type: 'varchar',
		length: '64',
		isNullable: true,
	}),
];

const EXCHANGE_EVENT_TYPE = 'CURRENCY_EXCHANGE';
const EXCHANGE_EVENT_SOURCE = 'RULE';
const EXCHANGE_RULE_VERSION = 'revolut-currency-exchange-v1';

const REVOLUT_EXCHANGE_CANDIDATE = `
	upper(trim(connection."provider")) = 'ENABLE-BANKING'
	AND lower(trim(connection."aspspName")) = 'revolut'
	AND upper(trim(account."currency")) ~ '^[A-Z]{3}$'
	AND upper(trim(bt."currency")) ~ '^[A-Z]{3}$'
	AND upper(trim(account."currency")) = upper(trim(bt."currency"))
	AND btrim(regexp_replace(coalesce(bt."description", ''), '[[:space:]]+', ' ', 'g')) ~* '^Exchanged to [A-Za-z]{3}$'
	AND (
		(upper(trim(bt."creditDebitIndicator")) = 'DBIT'
			AND upper(trim(bt."currency")) <> upper(right(
				btrim(regexp_replace(coalesce(bt."description", ''), '[[:space:]]+', ' ', 'g')),
				3
			)))
		OR (upper(trim(bt."creditDebitIndicator")) = 'CRDT'
			AND upper(trim(bt."currency")) = upper(right(
				btrim(regexp_replace(coalesce(bt."description", ''), '[[:space:]]+', ' ', 'g')),
				3
			)))
	)
`;

export class AddBankTransactionFinancialEvent20260917200000 implements MigrationInterface {
	name = 'AddBankTransactionFinancialEvent20260917200000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;

		for (const column of FINANCIAL_EVENT_COLUMNS) {
			if (!(await queryRunner.hasColumn('bank_transactions', column.name))) {
				await queryRunner.addColumn('bank_transactions', column);
			}
		}

		await queryRunner.query(`
			UPDATE "bank_transactions" AS bt
			SET
				"financialEventType" = '${EXCHANGE_EVENT_TYPE}',
				"financialEventSource" = '${EXCHANGE_EVENT_SOURCE}',
				"financialEventRuleVersion" = '${EXCHANGE_RULE_VERSION}',
				"categoryInputHash" = NULL,
				"category" = CASE WHEN "categorySource" = 'MANUAL' THEN "category" ELSE NULL END,
				"categoryStatus" = CASE
					WHEN "categorySource" = 'MANUAL' THEN "categoryStatus"
					ELSE 'NOT_APPLICABLE'
				END,
				"categorySource" = CASE WHEN "categorySource" = 'MANUAL' THEN "categorySource" ELSE NULL END,
				"categoryConfidence" = CASE WHEN "categorySource" = 'MANUAL' THEN "categoryConfidence" ELSE NULL END,
				"categoryAppliedInputHash" = CASE WHEN "categorySource" = 'MANUAL' THEN "categoryAppliedInputHash" ELSE NULL END,
				"categoryProvider" = CASE WHEN "categorySource" = 'MANUAL' THEN "categoryProvider" ELSE NULL END,
				"categoryModel" = CASE WHEN "categorySource" = 'MANUAL' THEN "categoryModel" ELSE NULL END,
				"categoryPromptVersion" = CASE WHEN "categorySource" = 'MANUAL' THEN "categoryPromptVersion" ELSE NULL END,
				"categorySearchTrace" = CASE WHEN "categorySource" = 'MANUAL' THEN "categorySearchTrace" ELSE NULL END,
				"categoryLastError" = CASE WHEN "categorySource" = 'MANUAL' THEN "categoryLastError" ELSE NULL END,
				"categoryUpdatedAt" = CASE WHEN "categorySource" = 'MANUAL' THEN "categoryUpdatedAt" ELSE NULL END
			FROM "bank_accounts" AS account
			JOIN "bank_connections" AS connection ON connection."id" = account."bankConnectionId"
			WHERE bt."bankAccountId" = account."id"
				AND ${REVOLUT_EXCHANGE_CANDIDATE}
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable('bank_transactions'))) return;

		for (const column of [...FINANCIAL_EVENT_COLUMNS].reverse()) {
			if (await queryRunner.hasColumn('bank_transactions', column.name)) {
				await queryRunner.dropColumn('bank_transactions', column.name);
			}
		}
	}
}
