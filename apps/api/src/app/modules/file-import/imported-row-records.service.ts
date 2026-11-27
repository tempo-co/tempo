import {Injectable, NotFoundException} from '@nestjs/common';
import type {EntityManager} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BATCH_WRITE_CHUNK_SIZE, chunkArray} from '@modules/banking/banking.utils';
import {
	AccountImportRange,
	ImportedRowQuestion,
	ImportedRowRecords,
	ImportedRowRecordsRegistry,
	RemovedImportedRow,
	StatementClosingBalance,
} from '@modules/banking/services/imported-row-records';

import {BANK_IMPORT_NOT_FOUND} from './bank-import.service';
import type {NormalizedRow} from './parsers/parse-result';

/**
 * File import's records of the rows it added, as banking's writes change those rows: sync's questions about imported
 * rows, rows sync took over or removed, and the closing balances imports recorded.
 */
@Injectable()
export class ImportedRowRecordsService implements ImportedRowRecords {
	// Registered as the provider is made, before any lifecycle hook starts the queue workers whose syncs use it.
	constructor(registry: ImportedRowRecordsRegistry) {
		registry.register(this);
	}

	async findKeptByOwner(
		manager: EntityManager,
		ownerId: Account['id'],
		transactionIds: readonly string[],
	): Promise<Set<string>> {
		if (transactionIds.length === 0) return new Set();
		const kept: Array<{id: string}> = await manager.query(
			`SELECT DISTINCT answered."resolvedTransactionId" AS "id" FROM "bank_import_doubtful_rows" answered
			INNER JOIN "bank_imports" bank_import ON bank_import."id" = answered."importId"
			WHERE answered."resolvedTransactionId" = ANY($1::uuid[]) AND answered."resolution" = 'new'
				AND bank_import."accountId" = $2`,
			[transactionIds, ownerId],
		);
		return new Set(kept.map(({id}) => id));
	}

	async recordTakenOver(
		manager: EntityManager,
		ownerId: Account['id'],
		bankAccountId: BankAccount['id'],
		transactionIds: readonly string[],
	): Promise<void> {
		if (transactionIds.length === 0) return;
		const [removed]: [Array<{importId: string}>, number] = await manager.query(
			`DELETE FROM "bank_import_doubtful_rows" doubtful
			USING "bank_imports" bank_import
			WHERE doubtful."importedTransactionId" = ANY($1::uuid[]) AND doubtful."bankAccountId" = $2
				AND doubtful."resolution" IS NULL
				AND bank_import."id" = doubtful."importId" AND bank_import."accountId" = $3
			RETURNING doubtful."importId"`,
			[transactionIds, bankAccountId, ownerId],
		);
		for (const {importId} of removed) await this.changeDoubtfulCount(manager, ownerId, importId, -1);
	}

	async askAbout(
		manager: EntityManager,
		ownerId: Account['id'],
		bankAccountId: BankAccount['id'],
		questions: readonly ImportedRowQuestion[],
	): Promise<number> {
		let asked = 0;
		for (const {imported, candidateIds} of questions) {
			const [updated]: [unknown[], number] = await manager.query(
				`UPDATE "bank_import_doubtful_rows" doubtful
				SET "candidateTransactionIds" = ARRAY(SELECT DISTINCT unnest(doubtful."candidateTransactionIds" || $2::uuid[])), "updatedAt" = now()
				FROM "bank_imports" bank_import
				WHERE doubtful."importedTransactionId" = $1 AND doubtful."resolution" IS NULL
					AND bank_import."id" = doubtful."importId" AND bank_import."accountId" = $3
				RETURNING doubtful."id"`,
				[imported.id, candidateIds, ownerId],
			);
			if (updated.length > 0) continue;
			const inserted: unknown[] = await manager.query(
				`INSERT INTO "bank_import_doubtful_rows"
					("importId", "bankAccountId", "row", "candidateTransactionIds", "importedTransactionId")
				SELECT bank_import."id", $2, $3::jsonb, $4::uuid[], $5
				FROM "bank_imports" bank_import WHERE bank_import."id" = $1 AND bank_import."accountId" = $6
				RETURNING "id"`,
				[
					imported.importId,
					bankAccountId,
					JSON.stringify(toImportedRowSnapshot(imported)),
					candidateIds,
					imported.id,
					ownerId,
				],
			);
			if (inserted.length === 0) continue;
			await this.changeDoubtfulCount(manager, ownerId, imported.importId!, 1);
			asked += 1;
		}
		return asked;
	}

	async recordRemovedBySync(
		manager: EntityManager,
		ownerId: Account['id'],
		bankAccountId: BankAccount['id'],
		removed: readonly RemovedImportedRow[],
	): Promise<void> {
		if (removed.length === 0) return;
		for (const chunk of chunkArray(removed, BATCH_WRITE_CHUNK_SIZE)) {
			await manager.query(
				`INSERT INTO "bank_import_doubtful_rows"
					("importId", "bankAccountId", "kind", "row", "candidateTransactionIds", "ownerEdits")
				SELECT snapshot."importId", $1, 'removed_by_sync', snapshot."row", '{}', snapshot."ownerEdits"
				FROM jsonb_to_recordset($2::jsonb) AS snapshot("importId" uuid, "row" jsonb, "ownerEdits" jsonb)
				INNER JOIN "bank_imports" bank_import ON bank_import."id" = snapshot."importId"
				WHERE bank_import."accountId" = $3`,
				[
					bankAccountId,
					JSON.stringify(
						chunk.map(({row, ownerEdits}) => ({
							importId: row.importId,
							row: toImportedRowSnapshot(row),
							ownerEdits,
						})),
					),
					ownerId,
				],
			);
		}

		// Open questions go with their rows; answered ones stop pointing at a row that is gone.
		const ids = removed.map(({row}) => row.id);
		const [closed]: [Array<{importId: string}>, number] = await manager.query(
			`DELETE FROM "bank_import_doubtful_rows" doubtful
			USING "bank_imports" bank_import
			WHERE doubtful."importedTransactionId" = ANY($1::uuid[]) AND doubtful."resolution" IS NULL
				AND bank_import."id" = doubtful."importId" AND bank_import."accountId" = $2
			RETURNING doubtful."importId"`,
			[ids, ownerId],
		);
		await manager.query(
			`UPDATE "bank_import_doubtful_rows" doubtful SET "importedTransactionId" = NULL, "updatedAt" = now()
			FROM "bank_imports" bank_import
			WHERE doubtful."importedTransactionId" = ANY($1::uuid[])
				AND bank_import."id" = doubtful."importId" AND bank_import."accountId" = $2`,
			[ids, ownerId],
		);
		const perImport = new Map<string, {removed: number; closed: number}>();
		const tally = (importId: string, field: 'removed' | 'closed') => {
			const counts = perImport.get(importId) ?? {removed: 0, closed: 0};
			counts[field] += 1;
			perImport.set(importId, counts);
		};
		for (const {row} of removed) tally(row.importId!, 'removed');
		for (const {importId} of closed) tally(importId, 'closed');
		for (const [importId, counts] of perImport) {
			await manager.query(
				`UPDATE "bank_imports"
				SET "rowsRemovedBySync" = "rowsRemovedBySync" + $2, "rowsAdded" = "rowsAdded" - $2,
					"rowsDoubtful" = "rowsDoubtful" - $3
				WHERE "id" = $1 AND "accountId" = $4`,
				[importId, counts.removed, counts.closed, ownerId],
			);
		}
	}

	async findNewestClosingBalance(
		manager: EntityManager,
		ownerId: Account['id'],
		bankAccountId: BankAccount['id'],
	): Promise<StatementClosingBalance | null> {
		// Joined through the account's own connection, so only its owner's imports count.
		const [statement]: StatementClosingBalance[] = await manager.query(
			`SELECT closing->>'date' AS "date", closing->>'amount' AS "amount"
			FROM "bank_accounts" bank_account
			JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			JOIN "bank_imports" bank_import ON bank_import."accountId" = connection."accountId"
				AND bank_import."undoneAt" IS NULL
			CROSS JOIN LATERAL jsonb_array_elements(bank_import."closingBalances") closing
			WHERE bank_account."id" = $1 AND connection."accountId" = $2 AND closing->>'bankAccountId' = $1::text
			ORDER BY closing->>'date' DESC, bank_import."createdAt" DESC
			LIMIT 1`,
			[bankAccountId, ownerId],
		);
		return statement ?? null;
	}

	async findImportRanges(manager: EntityManager, ownerId: Account['id']): Promise<AccountImportRange[]> {
		// Joined through each account's own connection, so only the owner's accounts that still exist count. An import
		// that wrote one account covers its whole date range there; one that wrote several covers, on each, the days
		// from that account's first to its last row the import added.
		return manager.query(
			`SELECT range."bankAccountId", to_char(range."from", 'YYYY-MM-DD') AS "from",
				to_char(range."to", 'YYYY-MM-DD') AS "to"
			FROM (
				SELECT bank_account."id" AS "bankAccountId",
					CASE WHEN cardinality(bank_import."bankAccountIds") = 1 THEN bank_import."dateFrom" ELSE added."from" END
						AS "from",
					CASE WHEN cardinality(bank_import."bankAccountIds") = 1 THEN bank_import."dateTo" ELSE added."to" END
						AS "to"
				FROM "bank_imports" bank_import
				CROSS JOIN LATERAL unnest(bank_import."bankAccountIds") written("id")
				JOIN "bank_accounts" bank_account ON bank_account."id" = written."id"
				JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
					AND connection."accountId" = $1
				LEFT JOIN LATERAL (
					SELECT MIN(added."date") AS "from", MAX(added."date") AS "to" FROM "bank_transactions" added
					WHERE added."importId" = bank_import."id" AND added."bankAccountId" = written."id"
				) added ON TRUE
				WHERE bank_import."accountId" = $1 AND bank_import."undoneAt" IS NULL
			) range
			WHERE range."from" IS NOT NULL AND range."to" IS NOT NULL`,
			[ownerId],
		);
	}

	async findAccountsWithClosingBalances(
		manager: EntityManager,
		ownerId: Account['id'],
		connectionId: BankConnection['id'],
	): Promise<BankAccount['id'][]> {
		const rows: Array<{bankAccountId: string}> = await manager.query(
			`SELECT DISTINCT closing->>'bankAccountId' AS "bankAccountId"
			FROM "bank_imports" bank_import
			CROSS JOIN LATERAL jsonb_array_elements(bank_import."closingBalances") closing
			WHERE bank_import."bankConnectionId" = $1 AND bank_import."accountId" = $2`,
			[connectionId, ownerId],
		);
		return rows.map(({bankAccountId}) => bankAccountId);
	}

	async refuseUnownedImport(manager: EntityManager, ownerId: Account['id'], importId: string): Promise<void> {
		const owned: Array<{id: string}> = await manager.query(
			`SELECT "id" FROM "bank_imports" WHERE "id" = $1 AND "accountId" = $2`,
			[importId, ownerId],
		);
		if (owned.length === 0) throw new NotFoundException(BANK_IMPORT_NOT_FOUND);
	}

	async forgetAccount(
		manager: EntityManager,
		ownerId: Account['id'],
		bankAccountId: BankAccount['id'],
	): Promise<void> {
		await manager.query(
			`DELETE FROM "bank_imports" bank_import
			WHERE bank_import."accountId" = $2 AND $1 = ANY(bank_import."bankAccountIds")
				AND NOT EXISTS (
					SELECT 1 FROM unnest(bank_import."bankAccountIds") named("id")
					INNER JOIN "bank_accounts" other ON other."id" = named."id"
					WHERE named."id" <> $1
				)`,
			[bankAccountId, ownerId],
		);
		// An open row of the account leaves its import's counts as it goes with the account.
		await manager.query(
			`UPDATE "bank_imports" bank_import SET
				"rowsDoubtful" = GREATEST(0, bank_import."rowsDoubtful" - open."doubtful"),
				"rowsNotInBank" = GREATEST(0, bank_import."rowsNotInBank" - open."notInBank"),
				"rowsRemovedBySync" = GREATEST(0, bank_import."rowsRemovedBySync" - open."removedBySync")
			FROM (
				SELECT doubtful."importId",
					COUNT(*) FILTER (WHERE doubtful."kind" = 'doubtful')::int AS "doubtful",
					COUNT(*) FILTER (WHERE doubtful."kind" = 'not_in_bank')::int AS "notInBank",
					COUNT(*) FILTER (WHERE doubtful."kind" = 'removed_by_sync')::int AS "removedBySync"
				FROM "bank_import_doubtful_rows" doubtful
				WHERE doubtful."bankAccountId" = $1 AND doubtful."resolution" IS NULL
				GROUP BY doubtful."importId"
			) open
			WHERE bank_import."id" = open."importId" AND bank_import."accountId" = $2`,
			[bankAccountId, ownerId],
		);
		await manager.query(
			`UPDATE "bank_imports" bank_import SET
				"bankAccountIds" = array_remove(bank_import."bankAccountIds", $1::uuid),
				"createdBankAccountIds" = array_remove(bank_import."createdBankAccountIds", $1::uuid),
				"closingBalances" = COALESCE((
					SELECT jsonb_agg(entry) FROM jsonb_array_elements(bank_import."closingBalances") entry
					WHERE entry->>'bankAccountId' IS DISTINCT FROM $1::uuid::text
				), '[]'::jsonb),
				"statementGaps" = COALESCE((
					SELECT jsonb_agg(entry) FROM jsonb_array_elements(bank_import."statementGaps") entry
					WHERE entry->>'bankAccountId' IS DISTINCT FROM $1::uuid::text
				), '[]'::jsonb)
			WHERE bank_import."accountId" = $2 AND $1 = ANY(bank_import."bankAccountIds")`,
			[bankAccountId, ownerId],
		);
	}

	async moveToConnection(
		manager: EntityManager,
		ownerId: Account['id'],
		from: BankConnection['id'],
		to: BankConnection['id'],
	): Promise<void> {
		await manager.query(
			`UPDATE "bank_imports" SET "bankConnectionId" = $1 WHERE "bankConnectionId" = $2 AND "accountId" = $3`,
			[to, from, ownerId],
		);
	}

	private async changeDoubtfulCount(
		manager: EntityManager,
		ownerId: Account['id'],
		importId: string,
		change: 1 | -1,
	): Promise<void> {
		await manager.query(
			`UPDATE "bank_imports" SET "rowsDoubtful" = "rowsDoubtful" + $2 WHERE "id" = $1 AND "accountId" = $3`,
			[importId, change, ownerId],
		);
	}
}

/** The imported row as a statement row, the shape a question shows; amounts keep at least two decimals. */
function toImportedRowSnapshot(transaction: BankTransaction): NormalizedRow {
	const decimal = (value: string | null) => value?.replace(/^(-?\d+\.\d{2}\d*?)0+$/, '$1') ?? null;
	return {
		bookingDate: transaction.bookingDate,
		valueDate: transaction.valueDate,
		transactionDate: transaction.transactionDate,
		amount: decimal(transaction.amount)!,
		creditDebitIndicator: transaction.creditDebitIndicator === 'CRDT' ? 'CRDT' : 'DBIT',
		currency: transaction.currency,
		balanceAfter: decimal(transaction.balanceAfterAmount),
		bankReference: transaction.entryReference,
		counterpartyName: transaction.counterpartyName,
		counterpartyIban: transaction.counterpartyIban,
		remittanceInformation: transaction.remittanceInformation,
		description: transaction.description,
		bankTransactionCode: transaction.bankTransactionCode,
		bankTransactionSubCode: transaction.bankTransactionSubCode,
		referenceNumber: transaction.referenceNumber,
	};
}
