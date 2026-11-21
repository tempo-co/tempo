import {Injectable, Logger} from '@nestjs/common';
import {FindOptionsSelect, In, IsNull, Not, QueryRunner, Raw, Repository} from 'typeorm';

import type {NormalizedRow} from '@modules/file-import/parsers/parse-result';

import {BankAccount} from '../bank-account.entity';
import type {CreditDebitIndicator} from '../bank-transaction-direction';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	detectCurrencyExchangeMarker,
} from '../bank-transaction-financial-event';
import {
	allocateNextBankTransactionStableIdentityKey,
	assignBankTransactionStableIdentityKeys,
	bankTransactionStableIdentityKeyRange,
	createBankTransactionStableIdentityGroupKey,
	createBankTransactionStableIdentityKey,
} from '../bank-transaction-identity';
import {BankTransactionLocation, normalizeBankTransactionLocation} from '../bank-transaction-location';
import {MATCH_WINDOW_DAYS, MatchIncomingRow, matchDay, matchWithReferenceFallback} from '../bank-transaction-matcher';
import {deriveBankTransactionTextColumns} from '../bank-transaction-text-columns';
import {normalizeBankTransactionType} from '../bank-transaction-type';
import {BankTransaction} from '../bank-transaction.entity';
import {
	BATCH_WRITE_CHUNK_SIZE,
	buildPostgresValuesList,
	chunkArray,
	normalizeBankCode,
	toDateOnly,
	truncate,
} from '../banking.utils';
import {
	createBankTransactionCategorizationInputHash,
	toBankTransactionCategorizationInput,
} from '../categorization/bank-transaction-categorization-input';
import {BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES} from '../categorization/bank-transaction-categorization.constants';
import {
	isManualCategorySource,
	notManualCategorySourceSql,
} from '../categorization/bank-transaction-categorization.types';
import {notOwnTransferCategorizedSql} from '../own-transfer/own-transfer-category';
import type {OwnTransferOverride} from '../own-transfer/own-transfer-detection';
import type {FinalSyncDays, SyncCoverage} from '../sync-coverage';
import {type CarryRow, pickCarryTargets} from '../sync-sweep';
import {BASE_AMOUNT_INPUT_COLUMNS, baseAmountInputsSql} from './bank-transaction-amount-conversion.utils';

const BANK_TRANSACTION_IDENTITY_SELECT = {
	id: true,
	bankAccountId: true,
	entryReference: true,
	transactionDate: true,
	bookingDate: true,
	valueDate: true,
	bookingDateFilled: true,
	valueDateFilled: true,
	amount: true,
	currency: true,
	creditDebitIndicator: true,
	bankTransactionCode: true,
	bankTransactionSubCode: true,
	bankTransactionDescription: true,
	description: true,
	counterpartyName: true,
	merchantLocation: true,
	merchantCategoryCode: true,
	remittanceInformation: true,
	instructedAmount: true,
	instructedCurrency: true,
	exchangeRate: true,
	exchangeRateUnitCurrency: true,
	exchangeRateType: true,
	referenceNumber: true,
	referenceNumberScheme: true,
	stableIdentityKey: true,
	stableIdentityGroupKey: true,
	transactionStatus: true,
} satisfies FindOptionsSelect<BankTransaction>;

export type ImportedTransactionsTarget = {
	/** The file import the rows are new rows of. */
	importId: string;
	/** The scheme the statement numbered the rows in (`BankTransaction.statementNumbering`). */
	statementNumbering: string | null;
};

/** An owner's choices on a row that move with it: a manual category and an own-transfer choice. */
export type OwnerEdits = {category: string | null; ownTransferOverride: OwnTransferOverride | null};

export type SweepImportedRowsResult = {
	removedCount: number;
	/** Rows whose own-transfer state the recompute after the sync must decide again. */
	recomputeIds: string[];
};

const PENDING_ROW_SQL = `UPPER(BTRIM("transactionStatus")) = 'PDNG'`;
/** A pending row's earliest date: a fetch window starting on or before it covers the row whichever date the bank filters on. */
const PENDING_ROW_START_SQL = 'LEAST("transactionDate", "bookingDate", "valueDate")';

export type PersistTransactionsResult = {
	transactionsAdded: number;
	/** The rows this call inserted; the others already existed and were updated. */
	insertedTransactionIds: string[];
	persistedTransactionIds: string[];
	/** Imported rows this write took over, including any the upsert skipped. */
	takenOverImportedIds: string[];
};

/** One transaction to write, from bank sync or a parsed statement file; `EnableBankingTransaction` satisfies it. */
export type BankTransactionInput = {
	providerTransactionId?: string;
	entryReference?: string;
	merchantCategoryCode?: string;
	amount: string;
	currency: string;
	creditDebitIndicator: CreditDebitIndicator;
	status?: string;
	transactionDate?: string;
	bookingDate?: string;
	valueDate?: string;
	/**
	 * The source sent no booking date; `bookingDate` is the transaction date (bank sync), or the value date, else the
	 * transaction date (statement files).
	 */
	bookingDateFilled?: boolean;
	/** The source sent no value date; `valueDate` is the transaction date. Statement files never set it. */
	valueDateFilled?: boolean;
	description?: string;
	counterpartyName?: string;
	counterpartyIban?: string;
	counterpartyLocation?: BankTransactionLocation;
	remittanceInformation?: string;
	bankTransactionCode?: string;
	bankTransactionSubCode?: string;
	bankTransactionDescription?: string;
	balanceAfterAmount?: string;
	balanceAfterCurrency?: string;
	instructedAmount?: string;
	instructedCurrency?: string;
	exchangeRate?: string;
	exchangeRateUnitCurrency?: string;
	exchangeRateType?: string;
	referenceNumber?: string;
	referenceNumberScheme?: string;
};

type BankTransactionValues = ReturnType<BankTransactionPersistenceService['toBankTransactionValues']>;

/**
 * Banks and statement files give a row no time of day, and every row one database transaction inserts shares its
 * `now()`. Each row is stamped a microsecond before the row listed above it, counting on across the writes of one
 * transaction, so the transaction list's `createdAt` tie-break shows a day's rows in the order the bank or file
 * lists them, newest first. Updates never set it, so a row keeps the time a write first stored it. Every caller writes
 * inside a transaction; without one, each chunk of a large import would start from its own `now()`.
 */
const stampedRowsByTransaction = new WeakMap<QueryRunner, number>();

function listedOrderCreatedAt(repository: Repository<BankTransaction>, count: number) {
	const runner = repository.manager.queryRunner;
	const first = runner ? (stampedRowsByTransaction.get(runner) ?? 0) : 0;
	if (runner) stampedRowsByTransaction.set(runner, first + count);
	return Array.from({length: count}, (_, index) => () => `now() - interval '${first + index} microseconds'`);
}

@Injectable()
export class BankTransactionPersistenceService {
	private readonly logger = new Logger(BankTransactionPersistenceService.name);

	/**
	 * The stored keys among the occurrences new rows of these groups could take. Each group is checked from its first
	 * occurrence until it has as many free occurrences as it has new rows, so allocating from the result never
	 * overwrites a stored row, including one that kept its key after moving to another group. The first query covers
	 * `newRows + storedRows` occurrences, which is enough unless rows moved between groups.
	 */
	private async findOccupiedTransactionIdentityKeys(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
		groups: ReadonlyArray<{groupKey: string; newRows: number; storedRows: number}>,
	): Promise<Set<string>> {
		const occupied = new Set<string>();
		let ranges = groups.map(({groupKey, newRows, storedRows}) => ({
			groupKey,
			needed: newRows,
			first: 1,
			count: newRows + storedRows,
		}));
		while (ranges.length > 0) {
			const candidates = ranges.map((range) => ({
				...range,
				keys: bankTransactionStableIdentityKeyRange(range.groupKey, range.first, range.count),
			}));
			for (const keys of chunkArray(
				candidates.flatMap(({keys}) => keys),
				BATCH_WRITE_CHUNK_SIZE,
			)) {
				const rows: Array<{stableIdentityKey: string}> = await repository.query(
					`SELECT "stableIdentityKey" FROM "bank_transactions"
					WHERE "bankAccountId" = $1 AND "stableIdentityKey" = ANY($2::varchar[])`,
					[bankAccountId, keys],
				);
				for (const {stableIdentityKey} of rows) occupied.add(stableIdentityKey);
			}
			ranges = candidates.flatMap(({groupKey, needed, first, count, keys}) => {
				const stillNeeded = needed - keys.filter((key) => !occupied.has(key)).length;
				return stillNeeded > 0 ? [{groupKey, needed: stillNeeded, first: first + count, count: count * 2}] : [];
			});
		}
		return occupied;
	}

	/**
	 * Writes a bank fetch's rows to the account by identity: a row matching a stored one updates it, and imported rows
	 * it lands on are taken over. `syncCoverage` is the account's coverage once this fetch is recorded: sync never
	 * asks about an imported row on a day inside it, since the day becomes final and the row is then taken over or
	 * removed.
	 */
	async persistTransactions(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		transactions: readonly BankTransactionInput[],
		aspspName: string,
		syncCoverage: SyncCoverage | null = null,
	): Promise<PersistTransactionsResult> {
		const unassignedTransactionValues = transactions.map((transaction) =>
			this.toBankTransactionValues(bankAccount, transaction, aspspName),
		);
		const stableIdentityGroupKeys = [
			...new Set(unassignedTransactionValues.map(({stableIdentityGroupKey}) => stableIdentityGroupKey)),
		];
		const entryReferences = [
			...new Set(
				unassignedTransactionValues.flatMap(({entryReference}) =>
					entryReference?.trim() ? [entryReference] : [],
				),
			),
		];
		const existingTransactions = await repository.find({
			select: {
				...BANK_TRANSACTION_IDENTITY_SELECT,
				categoryInputHash: true,
				categorySource: true,
				categoryStatus: true,
				importId: true,
				financialEventType: true,
			},
			// Include every same-reference candidate, not just pending rows: repeated references
			// and already-booked copies must make a cross-group transition ambiguous.
			where: entryReferences.length
				? [
						{bankAccountId: bankAccount.id, stableIdentityGroupKey: In(stableIdentityGroupKeys)},
						{bankAccountId: bankAccount.id, entryReference: In(entryReferences)},
					]
				: {bankAccountId: bankAccount.id, stableIdentityGroupKey: In(stableIdentityGroupKeys)},
		});
		// Rows the assignment cannot match need free occurrences of their group; a stored row can hold one of them
		// after it moved to another group, so look at the keys themselves, not just the rows of the group.
		const countByGroup = (rows: ReadonlyArray<{stableIdentityGroupKey: string}>) =>
			rows.reduce(
				(counts, {stableIdentityGroupKey}) =>
					counts.set(stableIdentityGroupKey, (counts.get(stableIdentityGroupKey) ?? 0) + 1),
				new Map<string, number>(),
			);
		const newRowsByGroup = countByGroup(unassignedTransactionValues);
		const storedRowsByGroup = countByGroup(existingTransactions);
		const occupiedIdentityKeys = await this.findOccupiedTransactionIdentityKeys(
			repository,
			bankAccount.id,
			stableIdentityGroupKeys.map((groupKey) => ({
				groupKey,
				newRows: newRowsByGroup.get(groupKey) ?? 0,
				storedRows: storedRowsByGroup.get(groupKey) ?? 0,
			})),
		);
		let transactionValues = assignBankTransactionStableIdentityKeys(
			unassignedTransactionValues,
			existingTransactions,
			occupiedIdentityKeys,
		);
		// A pending row never takes over an imported row, even one equal to it in every identity field: it gets a
		// key of its own, and the imported row stays reserved (and is asked about when the row books).
		const importedByKey = new Map(
			existingTransactions.flatMap((row) => (row.importId ? [[row.stableIdentityKey, row] as const] : [])),
		);
		const kept = new Set<BankTransaction>();
		for (;;) {
			const blocked = transactionValues.flatMap((value) => {
				const row = isPendingStatus(value.transactionStatus) && importedByKey.get(value.stableIdentityKey);
				return row ? [row] : [];
			});
			if (blocked.length === 0) break;
			blocked.forEach((row) => kept.add(row));
			transactionValues = assignBankTransactionStableIdentityKeys(
				unassignedTransactionValues,
				existingTransactions.filter((row) => !kept.has(row)),
				new Set([...occupiedIdentityKeys, ...[...kept].map(({stableIdentityKey}) => stableIdentityKey)]),
			);
		}
		const stableIdentityKeys = transactionValues.map(({stableIdentityKey}) => stableIdentityKey);
		// Rows the write takes over from a file import: imported rows it updates by identity, and imported twins the
		// ladder finds for rows it would otherwise insert. Accounts without imported rows skip this entirely.
		const importedRows: unknown[] = await repository.query(
			`SELECT 1 FROM "bank_transactions" WHERE "bankAccountId" = $1 AND "importId" IS NOT NULL LIMIT 1`,
			[bankAccount.id],
		);
		const hasImportedRows = importedRows.length > 0;
		const {takenOverIds, questions} = hasImportedRows
			? await this.adoptImportedTwins(
					repository,
					bankAccount,
					transactionValues,
					existingTransactions,
					syncCoverage,
				)
			: {takenOverIds: [], questions: new Map<string, ImportQuestion>()};
		// The exchange recompute after the sync decides which marked rows are exchanges.
		const exchangeMarkerKeys = transactionValues.flatMap((value) =>
			detectCurrencyExchangeMarker({
				accountCurrency: bankAccount.currency,
				transactionCurrency: value.currency,
				creditDebitIndicator: value.creditDebitIndicator,
				description: value.description,
				bankTransactionCode: value.bankTransactionCode,
				bankTransactionSubCode: value.bankTransactionSubCode,
				bankTransactionDescription: value.bankTransactionDescription,
			})
				? [value.stableIdentityKey]
				: [],
		);

		const conflictColumns = ['bankAccountId', 'stableIdentityKey'];
		const overwriteColumns = Object.keys(transactionValues[0]).filter(
			(column) => !conflictColumns.includes(column),
		);
		const createdAt = listedOrderCreatedAt(repository, transactionValues.length);
		const upsertResult = await repository
			.createQueryBuilder()
			.insert()
			.into(BankTransaction)
			.values(transactionValues.map((value, position) => ({...value, createdAt: createdAt[position]})))
			.orUpdate(overwriteColumns, conflictColumns, {
				// A row the categorization worker holds keeps its values until the worker finishes, except one that
				// now carries a currency exchange marker, so the exchange recompute can take it out of categorization.
				overwriteCondition: {
					where: exchangeMarkerKeys.length
						? '("bank_transactions"."categoryStatus" IS DISTINCT FROM :processingStatus OR EXCLUDED."stableIdentityKey" IN (:...exchangeMarkerKeys))'
						: '"bank_transactions"."categoryStatus" IS DISTINCT FROM :processingStatus',
					parameters: {processingStatus: 'PROCESSING', exchangeMarkerKeys},
				},
			})
			// xmax is 0 only on a freshly inserted row version, so it tells inserts apart from updates.
			.returning('"id", ("xmax" = 0) AS "inserted"')
			// Rows skipped by the condition are missing from RETURNING, so merging it back by position would hand
			// the wrong ids to the values; keep them unmodified.
			.updateEntity(false)
			.execute();
		const insertedTransactionIds = this.getInsertedTransactionIds(upsertResult.raw);
		const transactionsAdded = insertedTransactionIds.length;
		// A row the upsert skipped (held by the categorization worker) keeps its import until a later sync writes it.
		const writtenIds = new Set((upsertResult.raw as Array<{id: string}>).map(({id}) => id));
		const adoptedIds = takenOverIds.filter((id) => writtenIds.has(id));
		for (const ids of chunkArray(adoptedIds, BATCH_WRITE_CHUNK_SIZE)) {
			// The row now belongs to the bank's history, so undoing its import leaves it.
			await repository.update({id: In(ids)}, {importId: null});
		}
		if (hasImportedRows) await this.recordImportQuestions(repository, bankAccount.id, questions, adoptedIds);

		await this.clearStaleBaseAmounts(repository, bankAccount.id, existingTransactions);
		await this.copySameCurrencyBaseAmounts(repository, bankAccount.id);

		const transactionByStableIdentityKey = new Map(
			transactionValues.map((value) => [value.stableIdentityKey, value]),
		);
		// A row whose classification-relevant fields changed goes back to the model, keeping its category until the new
		// one lands. Both sides are hashed here with the current rules, so a hash stored under older rules (which, for
		// example, still covered the dates) never counts as a change.
		const recheckIds: string[] = [];
		for (const existingTransaction of existingTransactions) {
			const currentValue = transactionByStableIdentityKey.get(existingTransaction.stableIdentityKey);
			if (
				!currentValue ||
				existingTransaction.financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE ||
				isManualCategorySource(existingTransaction.categorySource) ||
				// A row without a stored hash has never been categorized for this input.
				(existingTransaction.categoryInputHash !== null &&
					createBankTransactionCategorizationInputHash(
						toBankTransactionCategorizationInput({...existingTransaction, aspspName}),
					) === currentValue.categoryInputHash)
			) {
				continue;
			}
			recheckIds.push(existingTransaction.id);
		}

		for (const ids of chunkArray(recheckIds, BATCH_WRITE_CHUNK_SIZE)) {
			// The guards are evaluated per row, so one statement matches per-row updates exactly.
			await repository
				.createQueryBuilder()
				.update(BankTransaction)
				.set({categoryStatus: 'PENDING', categoryLastError: null})
				.where('"bankAccountId" = :bankAccountId', {bankAccountId: bankAccount.id})
				.andWhere('id IN (:...ids)', {ids})
				.andWhere(notManualCategorySourceSql())
				.andWhere(notOwnTransferCategorizedSql())
				.andWhere('"categoryStatus" IN (:...recheckStatuses)', {
					recheckStatuses: ['COMPLETED', 'FAILED', 'NOT_APPLICABLE'],
				})
				.andWhere('"financialEventType" IS NULL')
				.execute();
		}

		const persistedRows = await repository.find({
			select: {id: true},
			where: {bankAccountId: bankAccount.id, stableIdentityKey: In(stableIdentityKeys)},
		});

		return {
			transactionsAdded,
			insertedTransactionIds,
			persistedTransactionIds: persistedRows.map(({id}) => id),
			takenOverImportedIds: takenOverIds,
		};
	}

	/**
	 * Inserts a file import's new rows, each at the next free occurrence of its identity group, tagged with the
	 * import, never matched to or updating a stored row: the caller has already left out the duplicates. Plain
	 * inserts: a key collision fails the import instead of overwriting a stored row.
	 */
	async insertImportedTransactions(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		transactions: readonly BankTransactionInput[],
		aspspName: string,
		{importId, statementNumbering}: ImportedTransactionsTarget,
	): Promise<PersistTransactionsResult> {
		const unassignedTransactionValues = transactions.map((transaction) =>
			this.toBankTransactionValues(bankAccount, transaction, aspspName),
		);
		const newRowsByGroup = new Map<string, number>();
		for (const {stableIdentityGroupKey} of unassignedTransactionValues) {
			newRowsByGroup.set(stableIdentityGroupKey, (newRowsByGroup.get(stableIdentityGroupKey) ?? 0) + 1);
		}
		const usedKeys = await this.findOccupiedTransactionIdentityKeys(
			repository,
			bankAccount.id,
			[...newRowsByGroup].map(([groupKey, newRows]) => ({groupKey, newRows, storedRows: 0})),
		);
		const transactionValues = unassignedTransactionValues.map((value) => {
			const {stableIdentityKey} = allocateNextBankTransactionStableIdentityKey(
				value.stableIdentityGroupKey,
				usedKeys,
			);
			usedKeys.add(stableIdentityKey);
			return {...value, stableIdentityKey, importId, statementNumbering};
		});
		const insertedTransactionIds: string[] = [];
		const createdAt = listedOrderCreatedAt(repository, transactionValues.length);
		const listedValues = transactionValues.map((value, position) => ({...value, createdAt: createdAt[position]}));
		for (const chunk of chunkArray(listedValues, BATCH_WRITE_CHUNK_SIZE)) {
			const result = await repository
				.createQueryBuilder()
				.insert()
				.into(BankTransaction)
				.values(chunk)
				.returning('"id"')
				.updateEntity(false)
				.execute();
			insertedTransactionIds.push(...(result.raw as Array<{id: string}>).map(({id}) => id));
		}
		await this.copySameCurrencyBaseAmounts(repository, bankAccount.id, insertedTransactionIds);
		return {
			transactionsAdded: insertedTransactionIds.length,
			insertedTransactionIds,
			persistedTransactionIds: insertedTransactionIds,
			takenOverImportedIds: [],
		};
	}

	/**
	 * Finds the imported rows this write takes over, and the ones to ask the owner about. An incoming row that lands
	 * on an imported row by identity updates it. A booked incoming row that would be inserted adopts the imported twin
	 * the duplicate ladder finds (`matchWithReferenceFallback`: the imports' references are set aside when the bank's
	 * never equal them, and same-day look-alike groups as large on both sides pair off), by moving that row to the
	 * incoming identity before the upsert. The adopted row joins `existingTransactions`, so the usual
	 * re-categorization and base-amount rules see it. Pending rows adopt nothing. An imported row a doubtful incoming
	 * row may be, or one that looks like a booked row continuing a stored pending row, gets a question instead.
	 */
	private async adoptImportedTwins(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		transactionValues: ReadonlyArray<
			BankTransactionValues & {
				stableIdentityKey: string;
				stableIdentityGroupKey: string;
			}
		>,
		existingTransactions: BankTransaction[],
		syncCoverage: SyncCoverage | null,
	): Promise<{takenOverIds: string[]; questions: Map<string, ImportQuestion>}> {
		const existingByIdentity = new Map(
			existingTransactions.flatMap((transaction) =>
				transaction.stableIdentityKey ? [[transaction.stableIdentityKey, transaction] as const] : [],
			),
		);
		const takenOverIds = new Set<string>();
		const questions = new Map<string, ImportQuestion>();
		const toAdopt: Array<(typeof transactionValues)[number]> = [];
		const continued: Array<{value: (typeof transactionValues)[number]; stored: BankTransaction}> = [];
		for (const value of transactionValues) {
			const existing = existingByIdentity.get(value.stableIdentityKey);
			if (!existing) {
				if (!isPendingStatus(value.transactionStatus)) toAdopt.push(value);
			} else if (existing.importId) takenOverIds.add(existing.id);
			else if (isPendingStatus(existing.transactionStatus) && !isPendingStatus(value.transactionStatus)) {
				continued.push({value, stored: existing});
			}
		}
		const days = [...toAdopt, ...continued.map(({value}) => value)].flatMap((value) => {
			const day = matchDay(value);
			return day ? [day] : [];
		});
		if (days.length === 0) return {takenOverIds: [...takenOverIds], questions};
		days.sort();

		const imported = await repository.find({
			select: {
				...BANK_TRANSACTION_IDENTITY_SELECT,
				categoryInputHash: true,
				categorySource: true,
				categoryStatus: true,
				importId: true,
				balanceAfterAmount: true,
				counterpartyIban: true,
				createdAt: true,
			},
			where: {
				bankAccountId: bankAccount.id,
				importId: Not(IsNull()),
				bookingDate: Raw(
					(column) =>
						`COALESCE(${column}, "valueDate") BETWEEN (:from)::date - ${MATCH_WINDOW_DAYS} AND (:to)::date + ${MATCH_WINDOW_DAYS}`,
					{from: days[0], to: days.at(-1)},
				),
			},
		});
		const candidates = imported.filter(({id}) => !takenOverIds.has(id));
		const toExisting = (transaction: BankTransaction) => ({
			...toMatchRow(transaction),
			id: transaction.id,
			createdAt: transaction.createdAt,
			source: transaction.importId,
		});
		const ask = (transaction: BankTransaction, candidate: {key?: string; id?: string}) => {
			// Inside coverage the row waits for its day to become final instead.
			const day = matchDay(transaction);
			if (syncCoverage && day && day >= syncCoverage.from && day <= syncCoverage.through) return;
			const question = questions.get(transaction.id) ?? {
				imported: transaction,
				candidateKeys: [],
				candidateIds: [],
			};
			if (candidate.key) question.candidateKeys.push(candidate.key);
			if (candidate.id) question.candidateIds.push(candidate.id);
			questions.set(transaction.id, question);
		};
		const candidatesById = new Map(candidates.map((transaction) => [transaction.id, transaction]));
		const {outcomes} = matchWithReferenceFallback(toAdopt.map(toMatchRow), candidates.map(toExisting), {
			uniqueCandidatesOnly: true,
			pairLookAlikeGroups: true,
		});
		for (const [index, outcome] of outcomes.entries()) {
			if (outcome.kind !== 'matched') continue;
			const value = toAdopt[index];
			const twin = candidatesById.get(outcome.existingId)!;
			await repository.update(
				{id: twin.id},
				{stableIdentityKey: value.stableIdentityKey, stableIdentityGroupKey: value.stableIdentityGroupKey},
			);
			existingTransactions.push({
				...twin,
				stableIdentityKey: value.stableIdentityKey,
				stableIdentityGroupKey: value.stableIdentityGroupKey,
			});
			takenOverIds.add(twin.id);
		}
		for (const [index, outcome] of outcomes.entries()) {
			if (outcome.kind !== 'doubtful') continue;
			for (const id of outcome.candidateIds) {
				if (!takenOverIds.has(id)) ask(candidatesById.get(id)!, {key: toAdopt[index].stableIdentityKey});
			}
		}
		// A booked row continuing a pending one is already stored, so an imported look-alike is only ever asked about.
		const left = candidates.filter(({id}) => !takenOverIds.has(id));
		if (continued.length > 0 && left.length > 0) {
			const {outcomes: continuedOutcomes} = matchWithReferenceFallback(
				continued.map(({value}) => toMatchRow(value)),
				left.map(toExisting),
				{uniqueCandidatesOnly: true},
			);
			for (const [index, outcome] of continuedOutcomes.entries()) {
				const ids =
					outcome.kind === 'matched'
						? [outcome.existingId]
						: outcome.kind === 'doubtful'
							? outcome.candidateIds
							: [];
				for (const id of ids) ask(candidatesById.get(id)!, {id: continued[index].stored.id});
			}
		}
		return {takenOverIds: [...takenOverIds], questions};
	}

	/**
	 * After the upsert: removes the open questions about imported rows this write took over, and asks about the
	 * imported rows `adoptImportedTwins` could not settle. Each question sits on the imported row's own import, names
	 * that row (`importedTransactionId`) and offers the synced look-alikes as candidates; a row already asked about
	 * gains the new candidates. The import's doubtful count follows.
	 */
	private async recordImportQuestions(
		repository: Repository<BankTransaction>,
		bankAccountId: string,
		questions: ReadonlyMap<string, ImportQuestion>,
		adoptedIds: readonly string[],
	): Promise<void> {
		const settle = async (importIds: ReadonlyArray<{importId: string}>, change: 1 | -1) => {
			for (const {importId} of importIds) {
				await repository.query(
					`UPDATE "bank_imports" SET "rowsDoubtful" = "rowsDoubtful" + $2 WHERE "id" = $1`,
					[importId, change],
				);
			}
		};
		if (adoptedIds.length > 0) {
			const [removed]: [Array<{importId: string}>, number] = await repository.query(
				`DELETE FROM "bank_import_doubtful_rows"
				WHERE "importedTransactionId" = ANY($1::uuid[]) AND "bankAccountId" = $2 AND "resolution" IS NULL
				RETURNING "importId"`,
				[adoptedIds, bankAccountId],
			);
			await settle(removed, -1);
		}
		const keys = [...new Set([...questions.values()].flatMap(({candidateKeys}) => candidateKeys))];
		const idByKey = new Map(
			keys.length === 0
				? []
				: (
						await repository.find({
							select: {id: true, stableIdentityKey: true},
							where: {bankAccountId, stableIdentityKey: In(keys)},
						})
					).map(({id, stableIdentityKey}) => [stableIdentityKey, id] as const),
		);
		let asked = 0;
		for (const {imported, candidateKeys, candidateIds} of questions.values()) {
			const ids = [
				...new Set([...candidateIds, ...candidateKeys.flatMap((key) => idByKey.get(key) ?? [])]),
			].filter((id) => id !== imported.id);
			if (ids.length === 0) continue;
			const [updated]: [unknown[], number] = await repository.query(
				`UPDATE "bank_import_doubtful_rows"
				SET "candidateTransactionIds" = ARRAY(SELECT DISTINCT unnest("candidateTransactionIds" || $2::uuid[])), "updatedAt" = now()
				WHERE "importedTransactionId" = $1 AND "resolution" IS NULL
				RETURNING "id"`,
				[imported.id, ids],
			);
			if (updated.length > 0) continue;
			await repository.query(
				`INSERT INTO "bank_import_doubtful_rows"
					("importId", "bankAccountId", "row", "candidateTransactionIds", "importedTransactionId")
				VALUES ($1, $2, $3::jsonb, $4::uuid[], $5)`,
				[imported.importId, bankAccountId, JSON.stringify(toImportedRowSnapshot(imported)), ids, imported.id],
			);
			await settle([{importId: imported.importId!}], 1);
			asked += 1;
		}
		if (asked > 0) this.logger.log(`Sync asked about ${asked} imported transaction(s) it could not match alone.`);
	}

	/**
	 * Bank sync is final for `finalDays`: it sent every payment of those days, and will never read them again. An
	 * imported row there that sync did not take over is one the bank never sent, so it is removed, with a snapshot on
	 * its import (`removed_by_sync`) the owner can add back. Its manual category and own-transfer choice move to the
	 * closest synced look-alike (`pickCarryTargets`) where that row has none, and its recurring hides follow it there.
	 * Rows the owner kept stay: any row a resolution `new` points at (`resolvedTransactionId`), whether added from a
	 * never-sent list, inserted by answering a doubtful row, or kept by answering a sync's question that it is a payment
	 * of its own. So do the rows this write took over (`takenOverIds`), even one the upsert skipped. Open questions about removed rows go with them; answered ones keep their answer.
	 */
	async sweepImportedRows(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		finalDays: FinalSyncDays,
		aspspName: string,
		takenOverIds: readonly string[],
	): Promise<SweepImportedRowsResult> {
		const removedIds: Array<{id: string}> = await repository.query(
			`SELECT t."id" FROM "bank_transactions" t
			WHERE t."bankAccountId" = $1 AND t."importId" IS NOT NULL AND NOT (${PENDING_ROW_SQL})
				AND COALESCE(t."bookingDate", t."valueDate") BETWEEN $2::date AND $3::date
				AND NOT (t."id" = ANY($4::uuid[]))
				AND NOT EXISTS (
					SELECT 1 FROM "bank_import_doubtful_rows" answered
					WHERE answered."resolvedTransactionId" = t."id" AND answered."resolution" = 'new'
				)`,
			[bankAccount.id, finalDays.from, finalDays.through, takenOverIds],
		);
		if (removedIds.length === 0) return {removedCount: 0, recomputeIds: []};
		// Locked, so an edit saved meanwhile either lands before the snapshot or finds the row gone.
		const removed = await repository.find({
			where: {id: In(removedIds.map(({id}) => id)), bankAccountId: bankAccount.id},
			order: {bookingDate: 'ASC', id: 'ASC'},
			lock: {mode: 'pessimistic_write'},
		});
		const ids = removed.map(({id}) => id);
		const days = removed.flatMap((row) => matchDay(row) ?? []).sort();
		const pool: BankTransaction[] = days.length
			? await repository.find({
					select: {
						id: true,
						amount: true,
						currency: true,
						bookingDate: true,
						valueDate: true,
						counterpartyName: true,
						description: true,
					},
					where: {
						bankAccountId: bankAccount.id,
						importId: IsNull(),
						...(takenOverIds.length ? {id: Not(In([...takenOverIds]))} : {}),
						transactionStatus: Raw((column) => `UPPER(BTRIM(COALESCE(${column}, ''))) <> 'PDNG'`),
						bookingDate: Raw(
							(column) =>
								`COALESCE(${column}, "valueDate") BETWEEN (:from)::date - ${MATCH_WINDOW_DAYS} AND (:to)::date + ${MATCH_WINDOW_DAYS}`,
							{from: days[0], to: days.at(-1)},
						),
					},
				})
			: [];
		const toCarryRow = (row: BankTransaction): CarryRow => ({
			id: row.id,
			amount: row.amount,
			currency: row.currency,
			bookingDate: row.bookingDate,
			valueDate: row.valueDate,
			text: toMatchRow(row).text ?? null,
		});
		const editsOf = (row: BankTransaction): OwnerEdits | null => {
			const category = isManualCategorySource(row.categorySource) ? row.category : null;
			return category || row.ownTransferOverride
				? {category, ownTransferOverride: row.ownTransferOverride}
				: null;
		};
		// Rows with edits choose first, so a row without any never takes the look-alike one with edits needs. The
		// others still get one of the rest, which their recurring hides follow.
		const withEdits = removed.filter((row) => editsOf(row));
		const targets = pickCarryTargets(withEdits.map(toCarryRow), pool.map(toCarryRow));
		const chosen = new Set([...targets.values()].filter((id): id is string => id !== null));
		for (const [id, target] of pickCarryTargets(
			removed.filter((row) => !editsOf(row)).map(toCarryRow),
			pool.filter(({id}) => !chosen.has(id)).map(toCarryRow),
		))
			targets.set(id, target);
		const recomputeIds: string[] = [];
		let moved = 0;
		for (const row of withEdits) {
			const target = targets.get(row.id);
			if (!target) continue;
			const applied = await this.applyOwnerEdits(repository, target, editsOf(row)!, aspspName);
			if (applied.category || applied.ownTransferOverride) moved += 1;
			if (applied.ownTransferOverride) recomputeIds.push(target);
		}

		for (const chunk of chunkArray(removed, BATCH_WRITE_CHUNK_SIZE)) {
			await repository.query(
				`INSERT INTO "bank_import_doubtful_rows"
					("importId", "bankAccountId", "kind", "row", "candidateTransactionIds", "ownerEdits")
				SELECT snapshot."importId", $1, 'removed_by_sync', snapshot."row", '{}', snapshot."ownerEdits"
				FROM jsonb_to_recordset($2::jsonb) AS snapshot("importId" uuid, "row" jsonb, "ownerEdits" jsonb)`,
				[
					bankAccount.id,
					JSON.stringify(
						chunk.map((row) => ({
							importId: row.importId,
							row: toImportedRowSnapshot(row),
							ownerEdits: editsOf(row),
						})),
					),
				],
			);
		}

		// A hidden series keeps following the payment: the look-alike stands in for the removed row, or it drops out.
		const hides: Array<{id: string; transactionIds: string[]}> = await repository.query(
			`SELECT hide."id", hide."transactionIds" FROM "recurring_series_hides" hide
			INNER JOIN "bank_connections" connection ON connection."accountId" = hide."accountId"
			INNER JOIN "bank_accounts" bank_account ON bank_account."bankConnectionId" = connection."id"
			WHERE bank_account."id" = $1 AND hide."transactionIds" && $2::uuid[]
			FOR UPDATE OF hide`,
			[bankAccount.id, ids],
		);
		const replacement = new Map(removed.map((row) => [row.id, targets.get(row.id) ?? null]));
		for (const hide of hides) {
			const transactionIds = [
				...new Set(
					hide.transactionIds.flatMap((id) => (replacement.has(id) ? (replacement.get(id) ?? []) : [id])),
				),
			];
			await repository.query(
				`UPDATE "recurring_series_hides" SET "transactionIds" = $2::uuid[], "updatedAt" = now() WHERE "id" = $1`,
				[hide.id, transactionIds],
			);
		}

		// Open questions go with their rows; answered ones stop pointing at a row that is gone.
		const [closed]: [Array<{importId: string}>, number] = await repository.query(
			`DELETE FROM "bank_import_doubtful_rows"
			WHERE "importedTransactionId" = ANY($1::uuid[]) AND "resolution" IS NULL
			RETURNING "importId"`,
			[ids],
		);
		await repository.query(
			`UPDATE "bank_import_doubtful_rows" SET "importedTransactionId" = NULL, "updatedAt" = now()
			WHERE "importedTransactionId" = ANY($1::uuid[])`,
			[ids],
		);
		const perImport = new Map<string, {removed: number; closed: number}>();
		const tally = (importId: string, field: 'removed' | 'closed') => {
			const counts = perImport.get(importId) ?? {removed: 0, closed: 0};
			counts[field] += 1;
			perImport.set(importId, counts);
		};
		for (const row of removed) tally(row.importId!, 'removed');
		for (const {importId} of closed) tally(importId, 'closed');
		for (const [importId, counts] of perImport) {
			await repository.query(
				`UPDATE "bank_imports"
				SET "rowsRemovedBySync" = "rowsRemovedBySync" + $2, "rowsAdded" = "rowsAdded" - $2,
					"rowsDoubtful" = "rowsDoubtful" - $3
				WHERE "id" = $1`,
				[importId, counts.removed, counts.closed],
			);
		}

		const formerCounterpartIds: string[] = [];
		for (const chunk of chunkArray(ids, BATCH_WRITE_CHUNK_SIZE)) {
			const result: unknown = await repository.query(
				`DELETE FROM "bank_transactions" WHERE "id" = ANY($1::uuid[]) RETURNING "ownTransferCounterpartId"`,
				[chunk],
			);
			// TypeORM returns [rows, affected] for a DELETE on PostgreSQL.
			const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : []) as Array<{
				ownTransferCounterpartId: string | null;
			}>;
			formerCounterpartIds.push(...rows.flatMap(({ownTransferCounterpartId}) => ownTransferCounterpartId ?? []));
		}
		this.logger.log(
			`Sync removed ${removed.length} imported row(s) it never sent on days it is final for, from ${perImport.size} import(s); edits moved for ${moved}.`,
		);
		return {removedCount: removed.length, recomputeIds: [...new Set([...formerCounterpartIds, ...recomputeIds])]};
	}

	/**
	 * Gives a row an owner's manual category and own-transfer choice, each only where the row has none of its own at
	 * the moment of the write, so a choice saved on it meanwhile is kept. Says which of the two landed.
	 */
	async applyOwnerEdits(
		repository: Repository<BankTransaction>,
		transactionId: string,
		edits: OwnerEdits,
		aspspName: string | undefined,
	): Promise<{category: boolean; ownTransferOverride: boolean}> {
		const applied = {category: false, ownTransferOverride: false};
		if (edits.category) {
			const target = await repository.findOneBy({id: transactionId});
			if (target && !isManualCategorySource(target.categorySource)) {
				const inputHash = createBankTransactionCategorizationInputHash(
					toBankTransactionCategorizationInput({...target, aspspName}),
				);
				const result = await repository
					.createQueryBuilder()
					.update()
					.set({
						...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
						category: edits.category,
						categoryStatus: 'COMPLETED',
						categorySource: 'MANUAL',
						categoryInputHash: inputHash,
						categoryAppliedInputHash: inputHash,
						categoryUpdatedAt: new Date(),
					})
					.where('id = :id', {id: transactionId})
					.andWhere(`"categorySource" IS DISTINCT FROM 'MANUAL'`)
					.execute();
				applied.category = (result.affected ?? 0) > 0;
			}
		}
		if (edits.ownTransferOverride) {
			const result = await repository
				.createQueryBuilder()
				.update()
				.set({ownTransferOverride: edits.ownTransferOverride})
				.where('id = :id', {id: transactionId})
				.andWhere(`"ownTransferOverride" IS NULL`)
				.execute();
			applied.ownTransferOverride = (result.affected ?? 0) > 0;
		}
		return applied;
	}

	/** The earliest date of each account's pending rows, so the account's next fetch still covers all of them. */
	async findPendingTransactionStarts(
		repository: Repository<BankTransaction>,
		bankAccountIds: readonly string[],
	): Promise<Map<string, string>> {
		if (bankAccountIds.length === 0) return new Map();
		const rows: Array<{bankAccountId: string; start: string | null}> = await repository.query(
			`SELECT "bankAccountId", to_char(MIN(${PENDING_ROW_START_SQL}), 'YYYY-MM-DD') AS "start"
			FROM "bank_transactions"
			WHERE "bankAccountId" = ANY($1::uuid[]) AND ${PENDING_ROW_SQL}
			GROUP BY "bankAccountId"`,
			[bankAccountIds],
		);
		return new Map(rows.flatMap(({bankAccountId, start}) => (start ? [[bankAccountId, start] as const] : [])));
	}

	/**
	 * Pending rows are temporary. After a complete fetch from `coveredFrom` (null: the account's whole history), a
	 * pending row of that window the fetch did not return was released or booked as another row, so it is deleted.
	 * Rows without any date count as covered. Returns the own-transfer counterparts the deleted rows were paired with,
	 * whose own-transfer state the recompute after the sync must decide again.
	 */
	async removeUnreturnedPendingTransactions(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
		returnedTransactionIds: readonly string[],
		coveredFrom: string | null,
	): Promise<string[]> {
		const result: unknown = await repository.query(
			`DELETE FROM "bank_transactions"
			WHERE "bankAccountId" = $1 AND ${PENDING_ROW_SQL}
				AND NOT ("id" = ANY($2::uuid[]))
				AND ($3::date IS NULL OR COALESCE(${PENDING_ROW_START_SQL}, $3::date) >= $3::date)
			RETURNING "ownTransferCounterpartId"`,
			[bankAccountId, returnedTransactionIds, coveredFrom],
		);
		// TypeORM returns [rows, affected] for a DELETE on PostgreSQL.
		const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : (result ?? [])) as Array<{
			ownTransferCounterpartId: string | null;
		}>;
		return rows.flatMap(({ownTransferCounterpartId}) =>
			ownTransferCounterpartId ? [ownTransferCounterpartId] : [],
		);
	}

	/**
	 * Stores amounts already in the owner's reporting currency right away, so they never wait for the conversion job
	 * and count in totals as soon as they are synced. Matches the job's `SAME` method; other currencies still wait
	 * for rates, and owners without a reporting currency for one. The calling transaction holds
	 * `lockReportingCurrencyForAmountWrites`, so the currency read here cannot change before it commits.
	 */
	private async copySameCurrencyBaseAmounts(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
		/** Limits the update to these rows; every row of the account when omitted. */
		transactionIds?: readonly string[],
	): Promise<void> {
		if (transactionIds?.length === 0) return;
		await repository.query(
			`UPDATE "bank_transactions" AS t
			SET "amountInBaseCurrency" = ROUND(t."amount", 2), "baseAmountMethod" = 'SAME',
				"baseAmountRateDate" = NULL, "updatedAt" = CURRENT_TIMESTAMP
			FROM "bank_accounts" bank_account
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			INNER JOIN "accounts" account ON account."id" = connection."accountId"
			WHERE bank_account."id" = $1
				AND t."bankAccountId" = bank_account."id"
				AND t."baseAmountMethod" IS NULL
				AND t."currency" = account."baseCurrency"${transactionIds ? ' AND t."id" = ANY($2::uuid[])' : ''}`,
			transactionIds ? [bankAccountId, transactionIds] : [bankAccountId],
		);
	}

	/**
	 * Clears base-currency amounts whose conversion inputs the upsert just changed, so the conversion job
	 * recomputes them. Compares the pre-sync snapshot with the stored row, so rows the upsert skipped keep theirs.
	 */
	private async clearStaleBaseAmounts(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
		previousTransactions: readonly BankTransaction[],
	): Promise<void> {
		const rows = previousTransactions.map((transaction) => [
			transaction.id,
			...BASE_AMOUNT_INPUT_COLUMNS.map(([column]) => transaction[column]),
		]);
		const casts = ['uuid', ...BASE_AMOUNT_INPUT_COLUMNS.map(([, cast]) => cast)];
		const columns = ['id', ...BASE_AMOUNT_INPUT_COLUMNS.map(([column]) => column)].map((column) => `"${column}"`);
		for (const chunk of chunkArray(rows, BATCH_WRITE_CHUNK_SIZE)) {
			const values = buildPostgresValuesList(chunk, casts);
			await repository.query(
				`UPDATE "bank_transactions" AS t
				SET "amountInBaseCurrency" = NULL, "baseAmountMethod" = NULL, "baseAmountRateDate" = NULL
				FROM (VALUES ${values.sql}) AS previous(${columns.join(', ')})
				WHERE t."bankAccountId" = $${values.parameters.length + 1}
					AND t."id" = previous."id"
					AND t."amountInBaseCurrency" IS NOT NULL
					AND ${baseAmountInputsSql('t')} IS DISTINCT FROM ${baseAmountInputsSql('previous')}`,
				[...values.parameters, bankAccountId],
			);
		}
	}

	private toBankTransactionValues(bankAccount: BankAccount, transaction: BankTransactionInput, aspspName: string) {
		const creditDebitIndicator = transaction.creditDebitIndicator;
		const amount = this.toSignedAmount(transaction.amount, creditDebitIndicator);
		const currency = normalizeBankCode(transaction.currency);
		const description = truncate(transaction.description, 500);
		const counterpartyName = truncate(transaction.counterpartyName, 255);
		const counterpartyIban = transaction.counterpartyIban ?? null;
		const {displayDescription, merchantKey} = deriveBankTransactionTextColumns({
			description,
			counterpartyName,
			creditDebitIndicator,
		});
		const remittanceInformation = truncate(transaction.remittanceInformation, 10_000);
		const transactionDate = toDateOnly(transaction.transactionDate);
		const bookingDate = toDateOnly(transaction.bookingDate);
		const valueDate = toDateOnly(transaction.valueDate);
		const bookingDateFilled = transaction.bookingDateFilled === true;
		const valueDateFilled = transaction.valueDateFilled === true;
		const providerTransactionId = truncate(transaction.providerTransactionId, 255);
		const entryReference = truncate(transaction.entryReference, 255);
		const bankTransactionCode = truncate(transaction.bankTransactionCode, 64);
		const bankTransactionSubCode = truncate(transaction.bankTransactionSubCode, 64);
		const bankTransactionDescription = truncate(transaction.bankTransactionDescription, 255);
		const merchantLocation = normalizeBankTransactionLocation(transaction.counterpartyLocation);
		const transactionType = normalizeBankTransactionType({
			code: bankTransactionCode ?? undefined,
			subCode: bankTransactionSubCode ?? undefined,
			aspspName,
		});
		const merchantCategoryCode = truncate(transaction.merchantCategoryCode, 16);
		const hasBalanceAfter = Boolean(transaction.balanceAfterAmount && transaction.balanceAfterCurrency);
		const hasInstructedAmount = Boolean(transaction.instructedAmount && transaction.instructedCurrency);
		const hasExchangeRate = Boolean(transaction.exchangeRate && transaction.exchangeRateUnitCurrency);
		const instructedAmount = hasInstructedAmount ? (transaction.instructedAmount ?? null) : null;
		const instructedCurrency = hasInstructedAmount ? normalizeBankCode(transaction.instructedCurrency!) : null;
		const exchangeRate = hasExchangeRate ? (transaction.exchangeRate ?? null) : null;
		const exchangeRateUnitCurrency = hasExchangeRate
			? normalizeBankCode(transaction.exchangeRateUnitCurrency!)
			: null;
		const exchangeRateType = truncate(transaction.exchangeRateType, 16);
		const referenceNumber = truncate(transaction.referenceNumber, 255);
		const referenceNumberScheme = truncate(transaction.referenceNumberScheme, 32);
		const identityValues = {
			bankAccountId: bankAccount.id,
			entryReference,
			transactionDate,
			bookingDate,
			valueDate,
			bookingDateFilled,
			valueDateFilled,
			amount,
			currency,
			creditDebitIndicator,
			bankTransactionCode,
			bankTransactionSubCode,
			bankTransactionDescription,
			description,
			counterpartyName,
			merchantLocation,
			merchantCategoryCode,
			remittanceInformation,
			instructedAmount,
			instructedCurrency,
			exchangeRate,
			exchangeRateUnitCurrency,
			exchangeRateType,
			referenceNumber,
			referenceNumberScheme,
		};
		const stableIdentityGroupKey = createBankTransactionStableIdentityGroupKey(identityValues);
		const stableIdentityKey = createBankTransactionStableIdentityKey(identityValues, 1);
		const categoryInputHash = createBankTransactionCategorizationInputHash(
			toBankTransactionCategorizationInput({
				id: stableIdentityKey,
				transactionDate,
				bookingDate,
				valueDate,
				amount,
				currency,
				creditDebitIndicator,
				bankTransactionCode,
				bankTransactionSubCode,
				aspspName,
				description,
				counterpartyName,
				bankTransactionDescription,
				merchantCategoryCode,
				remittanceInformation,
				merchantLocation,
			}),
		);

		return {
			bankAccountId: bankAccount.id,
			providerTransactionId,
			entryReference,
			stableIdentityKey,
			stableIdentityGroupKey,
			transactionDate,
			bookingDate,
			valueDate,
			bookingDateFilled,
			valueDateFilled,
			amount,
			currency,
			creditDebitIndicator,
			transactionType,
			transactionStatus: truncate(transaction.status, 32),
			bankTransactionCode,
			bankTransactionSubCode,
			bankTransactionDescription,
			description,
			displayDescription,
			merchantKey,
			counterpartyName,
			counterpartyIban,
			merchantCategoryCode,
			remittanceInformation,
			merchantLocation,
			categoryInputHash,
			balanceAfterAmount: hasBalanceAfter ? transaction.balanceAfterAmount : null,
			balanceAfterCurrency: hasBalanceAfter ? normalizeBankCode(transaction.balanceAfterCurrency!) : null,
			instructedAmount,
			instructedCurrency,
			exchangeRate,
			exchangeRateUnitCurrency,
			exchangeRateType,
			referenceNumber,
			referenceNumberScheme,
		};
	}

	private getInsertedTransactionIds(raw: unknown): string[] {
		const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
		return rows.flatMap((row) => {
			if (!row || typeof row !== 'object') return [];
			const {id, inserted} = row as {id?: unknown; inserted?: unknown};
			return typeof id === 'string' && inserted === true ? [id] : [];
		});
	}

	private toSignedAmount(amount: string, creditDebitIndicator: CreditDebitIndicator): string {
		const normalizedAmount = amount.trim();
		const isNegative = normalizedAmount.startsWith('-');
		const unsignedAmount = normalizedAmount.replace(/^[+-]/, '');

		if (creditDebitIndicator === 'DBIT' && !isNegative) return `-${unsignedAmount}`;
		if (creditDebitIndicator === 'CRDT' && isNegative) return unsignedAmount;
		return normalizedAmount;
	}
}

function toMatchRow(row: {
	amount: string;
	currency: string;
	bookingDate: string | null;
	valueDate: string | null;
	balanceAfterAmount?: string | null;
	entryReference: string | null;
	counterpartyName?: string | null;
	description?: string | null;
}): MatchIncomingRow {
	return {
		text: [row.counterpartyName, row.description].filter(Boolean).join(' ') || null,
		amount: row.amount,
		currency: row.currency,
		bookingDate: row.bookingDate,
		valueDate: row.valueDate,
		balanceAfter: row.balanceAfterAmount ?? null,
		reference: row.entryReference,
	};
}

/** An imported row the owner is asked about, and the synced rows (by identity key, or id once stored) it may be. */
type ImportQuestion = {imported: BankTransaction; candidateKeys: string[]; candidateIds: string[]};

function isPendingStatus(status: string | null | undefined): boolean {
	return status?.trim().toUpperCase() === 'PDNG';
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
