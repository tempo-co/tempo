import {MigrationInterface, QueryRunner} from 'typeorm';

const CHANGES_TABLE = 'bank_history_changes';
/**
 * Columns whose changes never alter what reads of an owner's history detect: categorization bookkeeping, pair links,
 * rule versions and timestamps. Every other column counts, so a column added later counts until it is listed here.
 */
const UNTRACKED_COLUMNS = [
	'categoryStatus',
	'categorySource',
	'categoryConfidence',
	'categoryInputHash',
	'categoryAppliedInputHash',
	'categoryProvider',
	'categoryModel',
	'categoryPromptVersion',
	'categoryUpdatedAt',
	'categoryLastError',
	'categorySearchTrace',
	'financialEventSource',
	'financialEventRuleVersion',
	'ownTransferOverride',
	'ownTransferCounterpartId',
	'currencyExchangeCounterpartId',
	'updatedAt',
];
const OWNER_OF = (rows: string) => `SELECT DISTINCT connection."accountId", txid_current()
	FROM (${rows}) changed
	JOIN "bank_accounts" account ON account."id" = changed."bankAccountId"
	JOIN "bank_connections" connection ON connection."id" = account."bankConnectionId"`;
const UNTRACKED = `ARRAY[${UNTRACKED_COLUMNS.map((column) => `'${column}'`).join(', ')}]::text[]`;

/**
 * Notes, per owner and writing transaction, that the owner's bank transactions changed. The changes only ever add up,
 * so their sum is a version of the owner's history that a reader can compare without reading the rows. Writers insert
 * their own key and never wait for each other. Rows deleted together with their bank account leave no note: readers
 * include the owner's account ids in the version instead.
 */
export class AddBankHistoryChanges20261113170000 implements MigrationInterface {
	name = 'AddBankHistoryChanges20261113170000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// A fresh database gets its tables from synchronize, which installs this afterwards (`installSchemaExtras`).
		if (!(await queryRunner.hasTable('bank_transactions')) || !(await queryRunner.hasTable('accounts'))) return;
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "${CHANGES_TABLE}" (
			"accountId" uuid NOT NULL,
			"transactionId" bigint NOT NULL,
			"weight" bigint NOT NULL DEFAULT 1,
			CONSTRAINT "PK_bank_history_changes" PRIMARY KEY ("accountId", "transactionId")
		)`);
		await queryRunner.query(`CREATE OR REPLACE FUNCTION note_bank_history_change() RETURNS trigger
			LANGUAGE plpgsql AS $$
			BEGIN
				IF TG_OP = 'INSERT' THEN
					INSERT INTO "${CHANGES_TABLE}" ("accountId", "transactionId")
					${OWNER_OF('SELECT "bankAccountId" FROM new_rows')}
					ON CONFLICT DO NOTHING;
				ELSIF TG_OP = 'DELETE' THEN
					INSERT INTO "${CHANGES_TABLE}" ("accountId", "transactionId")
					${OWNER_OF('SELECT "bankAccountId" FROM old_rows')}
					ON CONFLICT DO NOTHING;
				ELSE
					INSERT INTO "${CHANGES_TABLE}" ("accountId", "transactionId")
					${OWNER_OF(`SELECT moved."bankAccountId"
						FROM old_rows old_row
						JOIN new_rows new_row ON new_row."id" = old_row."id"
						CROSS JOIN LATERAL (VALUES (old_row."bankAccountId"), (new_row."bankAccountId")) moved("bankAccountId")
						WHERE to_jsonb(old_row) - ${UNTRACKED} IS DISTINCT FROM to_jsonb(new_row) - ${UNTRACKED}`)}
					ON CONFLICT DO NOTHING;
				END IF;
				RETURN NULL;
			END
			$$`);
		await queryRunner.query(`CREATE OR REPLACE TRIGGER "bank_transactions_history_insert"
			AFTER INSERT ON "bank_transactions" REFERENCING NEW TABLE AS new_rows
			FOR EACH STATEMENT EXECUTE FUNCTION note_bank_history_change()`);
		await queryRunner.query(`CREATE OR REPLACE TRIGGER "bank_transactions_history_update"
			AFTER UPDATE ON "bank_transactions" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
			FOR EACH STATEMENT EXECUTE FUNCTION note_bank_history_change()`);
		await queryRunner.query(`CREATE OR REPLACE TRIGGER "bank_transactions_history_delete"
			AFTER DELETE ON "bank_transactions" REFERENCING OLD TABLE AS old_rows
			FOR EACH STATEMENT EXECUTE FUNCTION note_bank_history_change()`);
		// No foreign key: its lock on the owner row would make writers wait on an account deletion holding their rows.
		await queryRunner.query(`CREATE OR REPLACE FUNCTION forget_bank_history_changes() RETURNS trigger
			LANGUAGE plpgsql AS $$
			BEGIN
				DELETE FROM "${CHANGES_TABLE}" WHERE "accountId" IN (SELECT "id" FROM old_rows);
				RETURN NULL;
			END
			$$`);
		await queryRunner.query(`CREATE OR REPLACE TRIGGER "accounts_history_changes_delete"
			AFTER DELETE ON "accounts" REFERENCING OLD TABLE AS old_rows
			FOR EACH STATEMENT EXECUTE FUNCTION forget_bank_history_changes()`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TRIGGER IF EXISTS "accounts_history_changes_delete" ON "accounts"`);
		for (const event of ['insert', 'update', 'delete']) {
			await queryRunner.query(
				`DROP TRIGGER IF EXISTS "bank_transactions_history_${event}" ON "bank_transactions"`,
			);
		}
		await queryRunner.query('DROP FUNCTION IF EXISTS forget_bank_history_changes()');
		await queryRunner.query('DROP FUNCTION IF EXISTS note_bank_history_change()');
		await queryRunner.query(`DROP TABLE IF EXISTS "${CHANGES_TABLE}"`);
	}
}
