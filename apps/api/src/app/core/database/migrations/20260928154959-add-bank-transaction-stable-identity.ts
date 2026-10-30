import {MigrationInterface, QueryRunner, TableColumn, TableIndex} from 'typeorm';

import {
	LEGACY_BANK_TRANSACTION_DEDUPE_KEY_PATTERN,
	allocateNextBankTransactionStableIdentityKey,
	createBankTransactionStableIdentityGroupKey,
} from '../../../modules/banking/bank-transaction-identity';
import type {BankTransactionIdentityInput} from '../../../modules/banking/bank-transaction-identity';

type BankTransactionIdentityRow = BankTransactionIdentityInput & {
	id: string;
	stableIdentityKey: string | null;
	stableIdentityGroupKey: string | null;
};

const TABLE_NAME = 'bank_transactions';
const IDENTITY_COLUMN_NAME = 'stableIdentityKey';
const IDENTITY_GROUP_COLUMN_NAME = 'stableIdentityGroupKey';
const IDENTITY_INDEX_NAME = 'idx_bank_transactions_account_stable_identity';
const IDENTITY_GROUP_INDEX_NAME = 'idx_bank_transactions_account_identity_group';
const UPDATE_BATCH_SIZE = 500;

export class AddBankTransactionStableIdentity20260928154959 implements MigrationInterface {
	name = 'AddBankTransactionStableIdentity20260928154959';

	public async up(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable(TABLE_NAME))) return;

		let addedColumn = false;
		if (!(await queryRunner.hasColumn(TABLE_NAME, IDENTITY_COLUMN_NAME))) {
			await queryRunner.addColumn(
				TABLE_NAME,
				new TableColumn({name: IDENTITY_COLUMN_NAME, type: 'varchar', length: '64', isNullable: true}),
			);
			addedColumn = true;
		}
		if (!(await queryRunner.hasColumn(TABLE_NAME, IDENTITY_GROUP_COLUMN_NAME))) {
			await queryRunner.addColumn(
				TABLE_NAME,
				new TableColumn({name: IDENTITY_GROUP_COLUMN_NAME, type: 'varchar', length: '64', isNullable: true}),
			);
			addedColumn = true;
		}

		let hasIncompleteIdentity = addedColumn;
		if (!hasIncompleteIdentity) {
			const result = (await queryRunner.query(
				`SELECT EXISTS (
					SELECT 1 FROM "${TABLE_NAME}"
					WHERE "${IDENTITY_COLUMN_NAME}" IS NULL OR "${IDENTITY_COLUMN_NAME}" = ''
						OR "${IDENTITY_GROUP_COLUMN_NAME}" IS NULL OR "${IDENTITY_GROUP_COLUMN_NAME}" = ''
				) AS "hasIncompleteIdentity"`,
			)) as Array<{hasIncompleteIdentity: boolean}>;
			hasIncompleteIdentity = result[0]?.hasIncompleteIdentity ?? false;
		}

		if (hasIncompleteIdentity) {
			const rows = (await queryRunner.query(
				`SELECT id, "bankAccountId", "stableIdentityKey", "stableIdentityGroupKey", "entryReference",
					to_char("transactionDate", 'YYYY-MM-DD') AS "transactionDate",
					to_char("bookingDate", 'YYYY-MM-DD') AS "bookingDate",
					to_char("valueDate", 'YYYY-MM-DD') AS "valueDate",
					amount::text AS amount,
					"currency", "creditDebitIndicator", "bankTransactionCode", "bankTransactionSubCode",
					"bankTransactionDescription", description, "counterpartyName", "merchantLocation", "merchantCategoryCode",
					"remittanceInformation", "instructedAmount"::text AS "instructedAmount", "instructedCurrency",
					"exchangeRate"::text AS "exchangeRate", "exchangeRateUnitCurrency", "exchangeRateType",
					"referenceNumber", "referenceNumberScheme"
				 FROM "${TABLE_NAME}"
				 ORDER BY "bankAccountId", id`,
			)) as BankTransactionIdentityRow[];
			const identifiedRows = assignIncompleteBankTransactionIdentityKeys(rows);

			for (let offset = 0; offset < identifiedRows.length; offset += UPDATE_BATCH_SIZE) {
				const batch = identifiedRows.slice(offset, offset + UPDATE_BATCH_SIZE);
				const parameters: string[] = [];
				const values = batch
					.map(({id, stableIdentityGroupKey, stableIdentityKey}, index) => {
						parameters.push(id, stableIdentityGroupKey, stableIdentityKey);
						const idParameter = index * 3 + 1;
						const groupParameter = idParameter + 1;
						const identityParameter = groupParameter + 1;
						return `($${idParameter}::uuid, $${groupParameter}::varchar, $${identityParameter}::varchar)`;
					})
					.join(', ');

				await queryRunner.query(
					`UPDATE "${TABLE_NAME}" AS transactions
					 SET "${IDENTITY_GROUP_COLUMN_NAME}" = batch."${IDENTITY_GROUP_COLUMN_NAME}",
						 "${IDENTITY_COLUMN_NAME}" = batch."${IDENTITY_COLUMN_NAME}"
					 FROM (VALUES ${values}) AS batch(id, "${IDENTITY_GROUP_COLUMN_NAME}", "${IDENTITY_COLUMN_NAME}")
					 WHERE transactions.id = batch.id`,
					parameters,
				);
			}
		}

		const table = await queryRunner.getTable(TABLE_NAME);
		const identityIndex = table?.indices.find(({name}) => name === IDENTITY_INDEX_NAME);
		if (!hasExpectedIndexDefinition(identityIndex, ['bankAccountId', IDENTITY_COLUMN_NAME], true)) {
			if (identityIndex) await queryRunner.dropIndex(TABLE_NAME, identityIndex);
			await queryRunner.createIndex(
				TABLE_NAME,
				new TableIndex({
					name: IDENTITY_INDEX_NAME,
					columnNames: ['bankAccountId', IDENTITY_COLUMN_NAME],
					isUnique: true,
				}),
			);
		}

		const identityGroupIndex = table?.indices.find(({name}) => name === IDENTITY_GROUP_INDEX_NAME);
		if (!hasExpectedIndexDefinition(identityGroupIndex, ['bankAccountId', IDENTITY_GROUP_COLUMN_NAME], false)) {
			if (identityGroupIndex) await queryRunner.dropIndex(TABLE_NAME, identityGroupIndex);
			await queryRunner.createIndex(
				TABLE_NAME,
				new TableIndex({
					name: IDENTITY_GROUP_INDEX_NAME,
					columnNames: ['bankAccountId', IDENTITY_GROUP_COLUMN_NAME],
				}),
			);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		if (!(await queryRunner.hasTable(TABLE_NAME))) return;

		const table = await queryRunner.getTable(TABLE_NAME);
		// Legacy sync used 64-character SHA-256 keys. New or changed rows use UUID markers when rollback would no longer dedupe them.
		// Compare the marker, not reconstructed row fields: PostgreSQL NUMERIC scale loses the provider's original amount text.
		const incompatibleDedupeKeyResult = (await queryRunner.query(
			`SELECT EXISTS (
				SELECT 1 FROM "${TABLE_NAME}"
				WHERE "dedupeKey" IS NULL OR "dedupeKey" !~ '${LEGACY_BANK_TRANSACTION_DEDUPE_KEY_PATTERN}'
			) AS "hasIncompatibleDedupeKey"`,
		)) as Array<{hasIncompatibleDedupeKey: boolean}>;
		if (incompatibleDedupeKeyResult[0]?.hasIncompatibleDedupeKey) {
			throw new Error(
				'Cannot safely roll back stable transaction identities while legacy dedupe keys are incompatible with the previous sync behavior.',
			);
		}

		for (const indexName of [IDENTITY_INDEX_NAME, IDENTITY_GROUP_INDEX_NAME]) {
			const index = table?.indices.find(({name}) => name === indexName);
			if (index) await queryRunner.dropIndex(TABLE_NAME, index);
		}
		if (await queryRunner.hasColumn(TABLE_NAME, IDENTITY_GROUP_COLUMN_NAME)) {
			await queryRunner.dropColumn(TABLE_NAME, IDENTITY_GROUP_COLUMN_NAME);
		}
		if (await queryRunner.hasColumn(TABLE_NAME, IDENTITY_COLUMN_NAME)) {
			await queryRunner.dropColumn(TABLE_NAME, IDENTITY_COLUMN_NAME);
		}
	}
}

type BankTransactionIdentityUpdate = {
	id: string;
	stableIdentityGroupKey: string;
	stableIdentityKey: string;
};

function assignIncompleteBankTransactionIdentityKeys(
	rows: BankTransactionIdentityRow[],
): BankTransactionIdentityUpdate[] {
	const usedKeysByAccount = new Map<string, Set<string>>();
	const getUsedKeys = (bankAccountId: string): Set<string> => {
		let usedKeys = usedKeysByAccount.get(bankAccountId);
		if (!usedKeys) {
			usedKeys = new Set();
			usedKeysByAccount.set(bankAccountId, usedKeys);
		}
		return usedKeys;
	};

	for (const row of rows) {
		if (row.stableIdentityKey) getUsedKeys(row.bankAccountId).add(row.stableIdentityKey);
	}

	const updates: BankTransactionIdentityUpdate[] = [];
	for (const row of rows) {
		if (row.stableIdentityKey && row.stableIdentityGroupKey) continue;

		const stableIdentityGroupKey = row.stableIdentityGroupKey || createBankTransactionStableIdentityGroupKey(row);
		const usedKeys = getUsedKeys(row.bankAccountId);
		const stableIdentityKey =
			row.stableIdentityKey ||
			allocateNextBankTransactionStableIdentityKey(stableIdentityGroupKey, usedKeys).stableIdentityKey;
		usedKeys.add(stableIdentityKey);
		updates.push({id: row.id, stableIdentityGroupKey, stableIdentityKey});
	}

	return updates;
}

function hasExpectedIndexDefinition(index: TableIndex | undefined, columnNames: string[], isUnique: boolean): boolean {
	return Boolean(
		index &&
		index.isUnique === isUnique &&
		!index.where &&
		index.columnNames.length === columnNames.length &&
		index.columnNames.every((columnName, position) => columnName === columnNames[position]),
	);
}
