import {Injectable, Logger} from '@nestjs/common';
import {createHash, randomUUID} from 'node:crypto';
import {FindOptionsSelect, In, IsNull, Not, Raw, Repository} from 'typeorm';

import {BankAccount} from '../bank-account.entity';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	detectBankTransactionFinancialEvent,
} from '../bank-transaction-financial-event';
import {
	allocateNextBankTransactionStableIdentityKey,
	assignBankTransactionStableIdentityKeys,
	createBankTransactionStableIdentityGroupKey,
	createBankTransactionStableIdentityKey,
	isLegacyBankTransactionDedupeKey,
} from '../bank-transaction-identity';
import {BankTransactionLocation, normalizeBankTransactionLocation} from '../bank-transaction-location';
import {MATCH_WINDOW_DAYS, MatchIncomingRow, matchDay, matchTransactions} from '../bank-transaction-matcher';
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
import {BASE_AMOUNT_INPUT_COLUMNS, baseAmountInputsSql} from './bank-transaction-amount-conversion.utils';

const BANK_TRANSACTION_IDENTITY_SELECT = {
	id: true,
	bankAccountId: true,
	entryReference: true,
	transactionDate: true,
	bookingDate: true,
	valueDate: true,
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

export type PersistTransactionsOptions = {
	/**
	 * Writes the rows as new rows of this file import: each gets the next free occurrence of its identity group and
	 * is inserted, never matched to or updating a stored row. The caller has already left out the duplicates.
	 */
	importId?: string;
};

export type PersistTransactionsResult = {
	transactionsAdded: number;
	/** The rows this call inserted; the others already existed and were updated. */
	insertedTransactionIds: string[];
	persistedTransactionIds: string[];
};

/** One transaction to write, from bank sync or a parsed statement file; `EnableBankingTransaction` satisfies it. */
export type BankTransactionInput = {
	providerTransactionId?: string;
	entryReference?: string;
	merchantCategoryCode?: string;
	amount: string;
	currency: string;
	creditDebitIndicator?: string;
	status?: string;
	transactionDate?: string;
	bookingDate?: string;
	valueDate?: string;
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

type LegacyDedupeKeyValues = {
	providerTransactionId: string | null;
	entryReference: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: string | null;
	description: string | null;
	counterpartyName: string | null;
	remittanceInformation: string | null;
};

@Injectable()
export class BankTransactionPersistenceService {
	private readonly logger = new Logger(BankTransactionPersistenceService.name);

	async repairIncompleteTransactionIdentities(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
	): Promise<void> {
		const incompleteTransactions = await repository.find({
			select: BANK_TRANSACTION_IDENTITY_SELECT,
			where: [
				{bankAccountId: bankAccount.id, stableIdentityKey: IsNull()},
				{bankAccountId: bankAccount.id, stableIdentityKey: ''},
				{bankAccountId: bankAccount.id, stableIdentityGroupKey: IsNull()},
				{bankAccountId: bankAccount.id, stableIdentityGroupKey: ''},
			],
			order: {id: 'ASC'},
		});
		if (incompleteTransactions.length === 0) return;

		const usedKeys = await this.getOccupiedTransactionIdentityKeys(repository, bankAccount.id);
		const identityUpdates = incompleteTransactions.map((transaction) => {
			const stableIdentityGroupKey =
				transaction.stableIdentityGroupKey || createBankTransactionStableIdentityGroupKey(transaction);
			let stableIdentityKey = transaction.stableIdentityKey;
			if (!stableIdentityKey) {
				stableIdentityKey = allocateNextBankTransactionStableIdentityKey(
					stableIdentityGroupKey,
					usedKeys,
				).stableIdentityKey;
			}
			usedKeys.add(stableIdentityKey);
			return {id: transaction.id, stableIdentityKey, stableIdentityGroupKey};
		});

		for (const chunk of chunkArray(identityUpdates, BATCH_WRITE_CHUNK_SIZE)) {
			const values = buildPostgresValuesList(
				chunk.map(({id, stableIdentityKey, stableIdentityGroupKey}) => [
					id,
					stableIdentityKey,
					stableIdentityGroupKey,
				]),
				['uuid', 'varchar', 'varchar'],
			);
			await repository.query(
				`UPDATE "bank_transactions" AS t
				SET "stableIdentityKey" = v."stableIdentityKey",
					"stableIdentityGroupKey" = v."stableIdentityGroupKey",
					"updatedAt" = CURRENT_TIMESTAMP
				FROM (VALUES ${values.sql}) AS v("id", "stableIdentityKey", "stableIdentityGroupKey")
				WHERE t."id" = v."id"`,
				values.parameters,
			);
		}
	}

	private async getOccupiedTransactionIdentityKeys(
		repository: Repository<BankTransaction>,
		bankAccountId: string,
	): Promise<Set<string>> {
		return (await this.getOccupiedTransactionIdentities(repository, bankAccountId)).keys;
	}

	/** Every identity key the account uses, and whether any of its rows still belongs to a file import. */
	private async getOccupiedTransactionIdentities(
		repository: Repository<BankTransaction>,
		bankAccountId: string,
	): Promise<{keys: Set<string>; hasImportedRows: boolean}> {
		const occupiedIdentities = await repository.find({
			select: {stableIdentityKey: true, importId: true},
			where: {bankAccountId, stableIdentityKey: Not(IsNull())},
		});
		return {
			keys: new Set(
				occupiedIdentities.flatMap(({stableIdentityKey}) => (stableIdentityKey ? [stableIdentityKey] : [])),
			),
			hasImportedRows: occupiedIdentities.some(({importId}) => Boolean(importId)),
		};
	}

	async persistTransactions(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		transactions: readonly BankTransactionInput[],
		aspspName: string,
		provider: string,
		options: PersistTransactionsOptions = {},
	): Promise<PersistTransactionsResult> {
		const unassignedTransactionValues = transactions.map((transaction) =>
			this.toBankTransactionValues(bankAccount, transaction, aspspName, provider),
		);
		if (options.importId) {
			return this.insertImportedTransactions(
				repository,
				bankAccount,
				unassignedTransactionValues,
				options.importId,
			);
		}
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
				dedupeKey: true,
				categoryInputHash: true,
				categorySource: true,
				categoryStatus: true,
				importId: true,
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
		// A booked row can retain a key from its former pending group while no longer
		// matching the incoming group or reference. Reserve keys independently of matching.
		const {keys: occupiedIdentityKeys, hasImportedRows} = await this.getOccupiedTransactionIdentities(
			repository,
			bankAccount.id,
		);
		const transactionValues = assignBankTransactionStableIdentityKeys(
			unassignedTransactionValues,
			existingTransactions,
			occupiedIdentityKeys,
		);
		const stableIdentityKeys = transactionValues.map(({stableIdentityKey}) => stableIdentityKey);
		const existingTransactionsByIdentity = new Map(
			existingTransactions
				.filter(({stableIdentityKey}) => stableIdentityKey)
				.map((transaction) => [transaction.stableIdentityKey as string, transaction]),
		);
		// Rows the write takes over from a file import: imported rows it updates by identity, and imported twins the
		// ladder finds for rows it would otherwise insert. Accounts without imported rows skip this entirely.
		const takenOverIds = hasImportedRows
			? await this.adoptImportedTwins(repository, bankAccount, transactionValues, existingTransactions)
			: [];
		for (const transactionValue of transactionValues) {
			const existingTransaction = existingTransactionsByIdentity.get(transactionValue.stableIdentityKey);
			if (!existingTransaction) {
				transactionValue.dedupeKey = randomUUID();
			} else if (existingTransaction.dedupeKey !== transactionValue.dedupeKey) {
				// UUID markers make rollback refuse rows the previous sync can no longer match by this legacy key.
				transactionValue.dedupeKey = isLegacyBankTransactionDedupeKey(existingTransaction.dedupeKey)
					? randomUUID()
					: existingTransaction.dedupeKey;
			}
		}

		const conflictColumns = ['bankAccountId', 'stableIdentityKey'];
		const overwriteColumns = Object.keys(transactionValues[0]).filter(
			(column) => !conflictColumns.includes(column),
		);
		const upsertResult = await repository
			.createQueryBuilder()
			.insert()
			.into(BankTransaction)
			.values(transactionValues)
			.orUpdate(overwriteColumns, conflictColumns, {
				// A row the categorization worker holds keeps its values until the worker finishes, except a currency
				// exchange, which leaves categorization below.
				overwriteCondition: {
					where: '("bank_transactions"."categoryStatus" IS DISTINCT FROM :processingStatus OR EXCLUDED."financialEventType" = :currencyExchangeType)',
					parameters: {
						processingStatus: 'PROCESSING',
						currencyExchangeType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
					},
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

		const eventTransactionValues = transactionValues.filter(
			({financialEventType}) => financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		);
		await this.clearStaleBaseAmounts(repository, existingTransactions);
		await this.copySameCurrencyBaseAmounts(repository, bankAccount.id);

		await this.markCurrencyExchangesNotCategorized(repository, bankAccount.id, eventTransactionValues);

		const transactionByStableIdentityKey = new Map(
			transactionValues.map((value) => [value.stableIdentityKey, value]),
		);
		const staleCategorizationIds: string[] = [];
		for (const existingTransaction of existingTransactions) {
			if (!existingTransaction.stableIdentityKey) continue;
			const currentValue = transactionByStableIdentityKey.get(existingTransaction.stableIdentityKey);
			if (
				!currentValue ||
				currentValue.financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE ||
				isManualCategorySource(existingTransaction.categorySource) ||
				existingTransaction.categoryStatus === 'COMPLETED' ||
				existingTransaction.categoryInputHash === currentValue.categoryInputHash
			) {
				continue;
			}
			staleCategorizationIds.push(existingTransaction.id);
		}

		for (const ids of chunkArray(staleCategorizationIds, BATCH_WRITE_CHUNK_SIZE)) {
			// The guards are evaluated per row, so one statement matches the former per-row updates exactly.
			await repository
				.createQueryBuilder()
				.update(BankTransaction)
				.set({
					...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
					categoryStatus: 'PENDING',
					categoryUpdatedAt: null,
				})
				.where('id IN (:...ids)', {ids})
				.andWhere(notManualCategorySourceSql())
				.andWhere('categoryStatus IS DISTINCT FROM :completedCategoryStatus', {
					completedCategoryStatus: 'COMPLETED',
				})
				.andWhere('"categoryStatus" IS DISTINCT FROM \'PROCESSING\'')
				.andWhere('"financialEventType" IS NULL')
				.execute();
		}

		const persistedRows = await repository.find({
			select: {id: true},
			where: {bankAccountId: bankAccount.id, stableIdentityKey: In(stableIdentityKeys)},
		});
		const persistedTransactionIds =
			persistedRows.length > 0 ? persistedRows.map(({id}) => id) : insertedTransactionIds;

		return {transactionsAdded, insertedTransactionIds, persistedTransactionIds};
	}

	/**
	 * Inserts a file import's new rows, each at the next free occurrence of its identity group, tagged with the
	 * import. Plain inserts: a key collision fails the import instead of overwriting a stored row.
	 */
	private async insertImportedTransactions(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		unassignedTransactionValues: BankTransactionValues[],
		importId: string,
	): Promise<PersistTransactionsResult> {
		const {keys: usedKeys} = await this.getOccupiedTransactionIdentities(repository, bankAccount.id);
		const transactionValues = unassignedTransactionValues.map((value) => {
			const {stableIdentityKey} = allocateNextBankTransactionStableIdentityKey(
				value.stableIdentityGroupKey,
				usedKeys,
			);
			usedKeys.add(stableIdentityKey);
			return {...value, stableIdentityKey, dedupeKey: randomUUID(), importId};
		});
		const insertedTransactionIds: string[] = [];
		for (const chunk of chunkArray(transactionValues, BATCH_WRITE_CHUNK_SIZE)) {
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
		await this.markCurrencyExchangesNotCategorized(
			repository,
			bankAccount.id,
			transactionValues.filter(
				({financialEventType}) =>
					financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			),
		);
		await this.copySameCurrencyBaseAmounts(repository, bankAccount.id, insertedTransactionIds);
		return {
			transactionsAdded: insertedTransactionIds.length,
			insertedTransactionIds,
			persistedTransactionIds: insertedTransactionIds,
		};
	}

	/**
	 * Finds the imported rows this write takes over. An incoming row that lands on an imported row by identity
	 * updates it; an incoming row that would be inserted adopts the imported twin the duplicate ladder finds when it
	 * is the only candidate, by moving that row to the incoming identity before the upsert. The adopted row joins
	 * `existingTransactions`, so the usual re-categorization and base-amount rules see it.
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
	): Promise<string[]> {
		const existingByIdentity = new Map(
			existingTransactions.flatMap((transaction) =>
				transaction.stableIdentityKey ? [[transaction.stableIdentityKey, transaction] as const] : [],
			),
		);
		const takenOverIds = new Set<string>();
		const toInsert: Array<(typeof transactionValues)[number]> = [];
		for (const value of transactionValues) {
			const existing = existingByIdentity.get(value.stableIdentityKey);
			if (!existing) toInsert.push(value);
			else if (existing.importId) takenOverIds.add(existing.id);
		}
		const days = toInsert.flatMap((value) => {
			const day = matchDay(value);
			return day ? [day] : [];
		});
		if (days.length === 0) return [...takenOverIds];
		days.sort();

		const imported = await repository.find({
			select: {
				...BANK_TRANSACTION_IDENTITY_SELECT,
				dedupeKey: true,
				categoryInputHash: true,
				categorySource: true,
				categoryStatus: true,
				importId: true,
				balanceAfterAmount: true,
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
		const outcomes = matchTransactions(
			toInsert.map(toMatchRow),
			candidates.map((transaction) => ({
				...toMatchRow(transaction),
				id: transaction.id,
				createdAt: transaction.createdAt,
			})),
			{uniqueCandidatesOnly: true},
		);
		const candidatesById = new Map(candidates.map((transaction) => [transaction.id, transaction]));
		let doubtful = 0;
		for (const [index, outcome] of outcomes.entries()) {
			if (outcome.kind === 'doubtful') doubtful += 1;
			if (outcome.kind !== 'matched') continue;
			const value = toInsert[index];
			const twin = candidatesById.get(outcome.existingId)!;
			await repository.update(
				{id: twin.id},
				{stableIdentityKey: value.stableIdentityKey, stableIdentityGroupKey: value.stableIdentityGroupKey},
			);
			existingTransactions.push({
				...twin,
				stableIdentityKey: value.stableIdentityKey,
				stableIdentityGroupKey: value.stableIdentityGroupKey,
			} as BankTransaction);
			takenOverIds.add(twin.id);
		}
		if (doubtful > 0) {
			this.logger.log(`Sync inserted ${doubtful} transaction(s) with more than one imported look-alike.`);
		}
		return [...takenOverIds];
	}

	private async markCurrencyExchangesNotCategorized(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
		eventTransactionValues: ReadonlyArray<{stableIdentityKey: string}>,
	): Promise<void> {
		const eventStableIdentityKeys = [
			...new Set(eventTransactionValues.map(({stableIdentityKey}) => stableIdentityKey)),
		];
		if (eventStableIdentityKeys.length === 0) return;
		await repository
			.createQueryBuilder()
			.update(BankTransaction)
			.set({
				...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
				categoryInputHash: null,
				categoryStatus: 'NOT_APPLICABLE',
				categoryUpdatedAt: null,
			})
			.where('"bankAccountId" = :bankAccountId', {bankAccountId})
			.andWhere('"stableIdentityKey" IN (:...eventStableIdentityKeys)', {eventStableIdentityKeys})
			.andWhere('"financialEventType" = :financialEventType', {
				financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			})
			.andWhere('"categorySource" IS DISTINCT FROM \'MANUAL\'')
			.execute();
	}

	/**
	 * Stores amounts already in the owner's base currency right away, so they never wait for the conversion job
	 * and count in totals as soon as they are synced. Matches the job's `SAME` method; other currencies still wait
	 * for rates. Owners without a base currency yet (before their first conversion run) are left to the job.
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
				WHERE t."id" = previous."id"
					AND t."amountInBaseCurrency" IS NOT NULL
					AND ${baseAmountInputsSql('t')} IS DISTINCT FROM ${baseAmountInputsSql('previous')}`,
				values.parameters,
			);
		}
	}

	private toBankTransactionValues(
		bankAccount: BankAccount,
		transaction: BankTransactionInput,
		aspspName: string,
		provider: string,
	) {
		const creditDebitIndicator = truncate(normalizeBankCode(transaction.creditDebitIndicator ?? ''), 8);
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
		const financialEvent = detectBankTransactionFinancialEvent({
			provider,
			aspspName,
			accountCurrency: bankAccount.currency,
			transactionCurrency: currency,
			creditDebitIndicator,
			description,
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
		const dedupeKey = this.createLegacyDedupeKey({
			providerTransactionId,
			entryReference,
			bookingDate,
			valueDate,
			amount,
			currency,
			creditDebitIndicator,
			description,
			counterpartyName,
			remittanceInformation,
		});
		const categoryInputHash = financialEvent
			? null
			: createBankTransactionCategorizationInputHash(
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
			dedupeKey,
			stableIdentityKey,
			stableIdentityGroupKey,
			transactionDate,
			bookingDate,
			valueDate,
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
			financialEventType: financialEvent?.type ?? null,
			financialEventSource: financialEvent?.source ?? null,
			financialEventRuleVersion: financialEvent?.ruleVersion ?? null,
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

	private createLegacyDedupeKey(values: LegacyDedupeKeyValues): string {
		const fallbackValues: Record<string, string | null> = {
			providerTransactionId: values.providerTransactionId,
			entryReference: values.entryReference,
			bookingDate: values.bookingDate,
			valueDate: values.valueDate,
			amount: values.amount,
			currency: values.currency,
			creditDebitIndicator: values.creditDebitIndicator,
			description: values.description,
			counterpartyName: values.counterpartyName,
			remittanceInformation: values.remittanceInformation,
		};
		const identity = values.providerTransactionId
			? `transaction:${values.providerTransactionId}`
			: values.entryReference
				? `entry:${values.entryReference}`
				: Object.entries(fallbackValues)
						.map(([key, value]) => `${key}:${value?.trim().toLowerCase() ?? ''}`)
						.join('|');

		return createHash('sha256').update(identity).digest('hex');
	}

	private toSignedAmount(amount: string, creditDebitIndicator: string | null): string {
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
}): MatchIncomingRow {
	return {
		amount: row.amount,
		currency: row.currency,
		bookingDate: row.bookingDate,
		valueDate: row.valueDate,
		balanceAfter: row.balanceAfterAmount ?? null,
		reference: row.entryReference,
	};
}
