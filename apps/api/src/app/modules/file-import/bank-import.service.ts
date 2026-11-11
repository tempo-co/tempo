import {ConflictException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import type {BankImportSummary} from '@tempo/contracts';
import {createHash} from 'node:crypto';
import {DataSource, EntityManager, In, IsNull, Not} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BATCH_WRITE_CHUNK_SIZE, chunkArray, safeErrorName} from '@modules/banking/banking.utils';
import {BankTransactionCategorizationService} from '@modules/banking/categorization/bank-transaction-categorization.service';
import {MerchantLogoService} from '@modules/banking/merchant-logos/merchant-logo.service';
import {verifyIbanAgainstIdentificationHash} from '@modules/banking/own-transfer/iban';
import {
	BankTransactionInput,
	BankTransactionPersistenceService,
} from '@modules/banking/services/bank-transaction-persistence.service';
import {
	BANK_CONNECTION_PROVIDERS,
	BANK_CONNECTION_STATUSES,
	BANK_SYNC_STATUSES,
	FILE_CONNECTION_ASPSP,
} from '@modules/banking/services/banking-sync.constants';
import {CurrencyExchangeService} from '@modules/banking/services/currency-exchange.service';
import {OwnTransferService} from '@modules/banking/services/own-transfer.service';

import {BankImportRefusalException} from './bank-import-refusal.exception';
import {BankImport} from './bank-import.entity';
import {MAX_ROWS_PER_DROP} from './parsers/parse-limits';
import {NormalizedRow, NormalizedStatement} from './parsers/parse-result';
import {ParseRunnerService} from './runner/parse-runner.service';

export const BANK_IMPORT_NOT_FOUND = 'Import not found.';
const BANK_IMPORT_NOT_SAVED = 'The import could not be saved. Please try again.';

/** The statements of one account in one drop, in booking order. */
type AccountRows = {
	identifier: string;
	iban: string | null;
	currency: string;
	rows: NormalizedRow[];
};

type ImportedAccount = {account: BankAccount; created: boolean};

@Injectable()
export class BankImportService {
	private readonly logger = new Logger(BankImportService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly parseRunner: ParseRunnerService,
		private readonly persistence: BankTransactionPersistenceService,
		private readonly ownTransferService: OwnTransferService,
		private readonly currencyExchangeService: CurrencyExchangeService,
		private readonly categorizationService: BankTransactionCategorizationService,
		private readonly merchantLogoService: MerchantLogoService,
	) {}

	/**
	 * Imports one drop into file-only accounts under the owner's "Imported files" connection, all or nothing.
	 * Rows keep the identity the transaction write path gives them, so dropping the same file again adds nothing.
	 */
	async importFiles(ownerId: Account['id'], files: readonly Buffer[]): Promise<BankImportSummary> {
		const statements = await this.parseDrop(files);
		const accountRows = groupByAccount(statements);
		const bookingDates = accountRows
			.flatMap(({rows}) => rows.flatMap(({bookingDate}) => (bookingDate ? [bookingDate] : [])))
			.sort();
		const rowsParsed = accountRows.reduce((count, {rows}) => count + rows.length, 0);

		const {record, accounts, persistedTransactionIds} = await this.dataSource.transaction(async (manager) => {
			await this.refuseSyncedAccounts(manager, ownerId, accountRows);
			const connection = await this.lockFileConnection(manager, ownerId);
			const accounts = await this.findOrCreateAccounts(manager, connection, accountRows);
			const imports = manager.getRepository(BankImport);
			const record = await imports.save(
				imports.create({
					accountId: ownerId,
					bankConnectionId: connection.id,
					fileHash: hashDrop(files),
					format: 'camt053',
					layout: null,
					filesCount: files.length,
					rowsParsed,
					rowsAdded: 0,
					rowsAlreadyPresent: rowsParsed,
					rowsDoubtful: 0,
					dateFrom: bookingDates[0] ?? null,
					dateTo: bookingDates.at(-1) ?? null,
					bankAccountIds: accounts.map(({account}) => account.id),
					createdBankAccountIds: accounts.filter(({created}) => created).map(({account}) => account.id),
				}),
			);

			const transactions = manager.getRepository(BankTransaction);
			const insertedIds: string[] = [];
			const persistedIds: string[] = [];
			for (const [index, {rows, currency}] of accountRows.entries()) {
				const {account} = accounts[index];
				for (const chunk of chunkByIdentityGroup(rows)) {
					const result = await this.persistence.persistTransactions(
						transactions,
						account,
						chunk.map((row) => toTransactionInput(row, currency)),
						connection.aspspName,
						connection.provider,
					);
					insertedIds.push(...result.insertedTransactionIds);
					persistedIds.push(...result.persistedTransactionIds);
				}
			}
			for (const ids of chunkArray(insertedIds, BATCH_WRITE_CHUNK_SIZE)) {
				await transactions.update({id: In(ids)}, {importId: record.id});
			}
			record.rowsAdded = insertedIds.length;
			record.rowsAlreadyPresent = rowsParsed - insertedIds.length;
			await imports.update(
				{id: record.id},
				{rowsAdded: record.rowsAdded, rowsAlreadyPresent: record.rowsAlreadyPresent},
			);
			return {record, accounts, persistedTransactionIds: [...new Set(persistedIds)]};
		});

		await this.afterRowsChanged(ownerId, persistedTransactionIds);
		return toSummary(
			record,
			accounts.map(({account}) => account),
		);
	}

	async findAll(ownerId: Account['id']): Promise<BankImportSummary[]> {
		const records = await this.dataSource.getRepository(BankImport).find({
			where: {accountId: ownerId},
			order: {createdAt: 'DESC', id: 'DESC'},
		});
		const accountIds = [...new Set(records.flatMap(({bankAccountIds}) => bankAccountIds))];
		const accounts = accountIds.length
			? await this.dataSource.getRepository(BankAccount).find({
					where: {id: In(accountIds), bankConnection: {accountId: ownerId}},
				})
			: [];
		return records.map((record) => toSummary(record, accounts));
	}

	/**
	 * Deletes exactly the rows the import inserted, then any imported-files account left without rows. Pointers to
	 * deleted rows (own-transfer and exchange counterparts) are cleared by their foreign keys and recomputed after.
	 */
	async undo(ownerId: Account['id'], importId: BankImport['id']): Promise<void> {
		const imports = this.dataSource.getRepository(BankImport);
		const owned = await imports.findOne({where: {id: importId, accountId: ownerId, undoneAt: IsNull()}});
		if (!owned) throw new NotFoundException(BANK_IMPORT_NOT_FOUND);

		await this.dataSource.transaction(async (manager) => {
			// Same lock order as an import and connection removal: the connection, then its children.
			const connection = await manager.getRepository(BankConnection).findOne({
				where: {id: owned.bankConnectionId, accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
				lock: {mode: 'pessimistic_write'},
			});
			const record = await manager.getRepository(BankImport).findOne({
				where: {id: importId, accountId: ownerId, undoneAt: IsNull()},
				lock: {mode: 'pessimistic_write'},
			});
			if (!connection || !record) throw new NotFoundException(BANK_IMPORT_NOT_FOUND);

			await manager.query(
				`DELETE FROM "bank_transactions" bank_transaction
				USING "bank_accounts" bank_account, "bank_connections" connection
				WHERE bank_transaction."importId" = $1
					AND bank_account."id" = bank_transaction."bankAccountId"
					AND connection."id" = bank_account."bankConnectionId"
					AND connection."accountId" = $2`,
				[record.id, ownerId],
			);
			await manager.getRepository(BankImport).update({id: record.id}, {undoneAt: new Date()});
			await manager.query(
				`DELETE FROM "bank_accounts" bank_account
				USING "bank_connections" connection
				WHERE bank_account."bankConnectionId" = $1
					AND connection."id" = bank_account."bankConnectionId"
					AND connection."accountId" = $2
					AND NOT EXISTS (
						SELECT 1 FROM "bank_transactions" bank_transaction WHERE bank_transaction."bankAccountId" = bank_account."id"
					)`,
				[connection.id, ownerId],
			);
		});

		await this.afterRowsChanged(ownerId, []);
	}

	/** Parses every file in request order; the first refusal names its file and nothing is written. */
	private async parseDrop(files: readonly Buffer[]): Promise<NormalizedStatement[]> {
		const statements: NormalizedStatement[] = [];
		const seen = new Set<string>();
		let rows = 0;
		for (const [index, file] of files.entries()) {
			const outcome = await this.parseRunner.parse(file);
			if (!outcome.ok) throw new BankImportRefusalException(outcome.code, index + 1);
			for (const statement of outcome.result.statements) {
				// A statement dropped twice in one go (an archive and its own files) is the same statement.
				const key = JSON.stringify(statement);
				if (seen.has(key)) continue;
				seen.add(key);
				rows += statement.rows.length;
				if (rows > MAX_ROWS_PER_DROP) throw new BankImportRefusalException('too_many_rows', index + 1);
				statements.push(statement);
			}
		}
		return statements;
	}

	/** Importing into an account bank sync already writes to comes with the duplicate matcher, not before. */
	private async refuseSyncedAccounts(
		manager: EntityManager,
		ownerId: Account['id'],
		accountRows: readonly AccountRows[],
	): Promise<void> {
		const ibans = accountRows.flatMap(({iban}) => (iban ? [iban] : []));
		if (ibans.length === 0) return;
		const syncedAccounts = await manager.getRepository(BankAccount).find({
			select: {id: true, iban: true, identificationHash: true, currency: true},
			where: {bankConnection: {accountId: ownerId, provider: Not(BANK_CONNECTION_PROVIDERS.FILE)}},
		});
		const synced = ibans.some((iban) =>
			syncedAccounts.some(
				(account) =>
					account.iban?.replace(/\s+/g, '').toUpperCase() === iban ||
					verifyIbanAgainstIdentificationHash(account.identificationHash, iban, account.currency),
			),
		);
		if (synced) throw new BankImportRefusalException('synced_account_not_supported_yet');
	}

	/**
	 * The owner's imported-files connection, created on the first import and locked for this transaction. The
	 * partial unique index makes two concurrent first imports end up with one connection; the row lock serializes
	 * imports, undo and removal of the connection.
	 */
	private async lockFileConnection(manager: EntityManager, ownerId: Account['id']): Promise<BankConnection> {
		const connections = manager.getRepository(BankConnection);
		await connections
			.createQueryBuilder()
			.insert()
			.into(BankConnection)
			.values({
				account: {id: ownerId},
				provider: BANK_CONNECTION_PROVIDERS.FILE,
				aspspName: FILE_CONNECTION_ASPSP.name,
				aspspCountry: FILE_CONNECTION_ASPSP.country,
				status: BANK_CONNECTION_STATUSES.AUTHORIZED,
				syncStatus: BANK_SYNC_STATUSES.IDLE,
				nextSyncAt: null,
				consentValidUntil: null,
				providerSessionId: null,
			})
			.orIgnore()
			.updateEntity(false)
			.execute();
		const connection = await connections.findOne({
			where: {accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
			lock: {mode: 'pessimistic_write'},
		});
		// Only a removal committing between the two statements gets here.
		if (!connection) throw new ConflictException(BANK_IMPORT_NOT_SAVED);
		return connection;
	}

	private async findOrCreateAccounts(
		manager: EntityManager,
		connection: BankConnection,
		accountRows: readonly AccountRows[],
	): Promise<ImportedAccount[]> {
		const bankAccounts = manager.getRepository(BankAccount);
		const accounts: ImportedAccount[] = [];
		for (const {identifier, iban, currency} of accountRows) {
			const providerAccountId = `file:${identifier}:${currency}`;
			const existing = await bankAccounts.findOne({
				where: {bankConnection: {id: connection.id}, providerAccountId},
			});
			if (existing) {
				accounts.push({account: existing, created: false});
				continue;
			}
			const account = await bankAccounts.save(
				bankAccounts.create({
					bankConnection: {id: connection.id},
					providerAccountId,
					identificationHash: `file:${createHash('sha256').update(`${identifier}:${currency}`).digest('hex')}`,
					iban,
					name: iban ? iban.replace(/(.{4})(?=.)/g, '$1 ') : identifier,
					currency,
					isActive: true,
				}),
			);
			accounts.push({account, created: true});
		}
		return accounts;
	}

	/** The steps sync runs after it persists rows, in the same order. */
	private async afterRowsChanged(ownerId: Account['id'], transactionIds: readonly string[]): Promise<void> {
		// Recompute first so new own transfers and exchanges are marked before the worker can claim them.
		await this.ownTransferService.recomputeForOwnerSafely(ownerId);
		await this.currencyExchangeService.recomputeForOwnerSafely(ownerId);
		if (transactionIds.length === 0) return;
		try {
			await this.categorizationService.enqueueForTransactions(transactionIds);
		} catch (error) {
			this.logger.warn(`Transaction categorization enqueue failed: ${safeErrorName(error)}`);
		}
		await this.merchantLogoService.enqueueForOwnerSafely(ownerId);
	}
}

/**
 * Orders statements by electronic sequence number, then first booking date, and joins each account's rows in that
 * order. An account is one (IBAN or other id, currency) pair.
 */
function groupByAccount(statements: readonly NormalizedStatement[]): AccountRows[] {
	const ordered = [...statements].sort(compareStatements);
	const groups = new Map<string, AccountRows>();
	for (const statement of ordered) {
		const identifier = (statement.accountIban ?? statement.accountOtherId) as string;
		const key = JSON.stringify([identifier, statement.accountCurrency]);
		const group = groups.get(key) ?? {
			identifier,
			iban: statement.accountIban,
			currency: statement.accountCurrency,
			rows: [],
		};
		group.rows.push(...statement.rows);
		groups.set(key, group);
	}
	return [...groups.values()];
}

function compareStatements(left: NormalizedStatement, right: NormalizedStatement): number {
	const leftSequence = sequenceOf(left);
	const rightSequence = sequenceOf(right);
	if (leftSequence !== rightSequence) {
		if (leftSequence === null) return 1;
		if (rightSequence === null) return -1;
		return leftSequence < rightSequence ? -1 : 1;
	}
	return firstBookingDate(left).localeCompare(firstBookingDate(right));
}

function sequenceOf(statement: NormalizedStatement): bigint | null {
	return statement.sequenceNumber && /^\d+$/.test(statement.sequenceNumber) ? BigInt(statement.sequenceNumber) : null;
}

function firstBookingDate(statement: NormalizedStatement): string {
	return statement.rows.find(({bookingDate}) => bookingDate)?.bookingDate ?? '9999-12-31';
}

/**
 * Splits an account's rows into write batches without separating rows that share an identity group (dates, amount,
 * currency and direction), so repeated payments are always numbered within one call.
 */
function chunkByIdentityGroup(rows: readonly NormalizedRow[]): NormalizedRow[][] {
	const groups = new Map<string, NormalizedRow[]>();
	for (const row of rows) {
		const key = JSON.stringify([
			row.transactionDate,
			row.bookingDate,
			row.valueDate,
			row.amount,
			row.currency,
			row.creditDebitIndicator,
		]);
		const group = groups.get(key) ?? [];
		group.push(row);
		groups.set(key, group);
	}
	const chunks: NormalizedRow[][] = [];
	let chunk: NormalizedRow[] = [];
	for (const group of groups.values()) {
		if (chunk.length > 0 && chunk.length + group.length > BATCH_WRITE_CHUNK_SIZE) {
			chunks.push(chunk);
			chunk = [];
		}
		chunk.push(...group);
	}
	if (chunk.length > 0) chunks.push(chunk);
	return chunks;
}

function toTransactionInput(row: NormalizedRow, accountCurrency: string): BankTransactionInput {
	return {
		entryReference: row.bankReference ?? undefined,
		amount: row.amount,
		currency: row.currency,
		creditDebitIndicator: row.creditDebitIndicator,
		status: 'BOOK',
		transactionDate: row.transactionDate ?? undefined,
		bookingDate: row.bookingDate ?? undefined,
		valueDate: row.valueDate ?? undefined,
		description: row.description ?? undefined,
		counterpartyName: row.counterpartyName ?? undefined,
		counterpartyIban: row.counterpartyIban ?? undefined,
		remittanceInformation: row.remittanceInformation ?? undefined,
		bankTransactionCode: row.bankTransactionCode ?? undefined,
		bankTransactionSubCode: row.bankTransactionSubCode ?? undefined,
		balanceAfterAmount: row.balanceAfter ?? undefined,
		balanceAfterCurrency: row.balanceAfter ? accountCurrency : undefined,
		referenceNumber: row.referenceNumber ?? undefined,
	};
}

/** sha256 of the file, or of the sorted per-file hashes when the drop holds several files. */
function hashDrop(files: readonly Buffer[]): string {
	const hashes = files.map((file) => createHash('sha256').update(file).digest('hex'));
	if (hashes.length === 1) return hashes[0];
	return createHash('sha256').update(hashes.sort().join('\n')).digest('hex');
}

function toSummary(record: BankImport, accounts: readonly BankAccount[]): BankImportSummary {
	const accountsById = new Map(accounts.map((account) => [account.id, account]));
	return {
		id: record.id,
		format: record.format,
		filesCount: record.filesCount,
		rowsParsed: record.rowsParsed,
		rowsAdded: record.rowsAdded,
		rowsAlreadyPresent: record.rowsAlreadyPresent,
		rowsDoubtful: record.rowsDoubtful,
		dateFrom: record.dateFrom,
		dateTo: record.dateTo,
		accounts: record.bankAccountIds.flatMap((id) => {
			const account = accountsById.get(id);
			if (!account) return [];
			return [
				{
					id,
					name: account.name,
					currency: account.currency,
					created: record.createdBankAccountIds.includes(id),
				},
			];
		}),
		undoneAt: record.undoneAt?.toISOString() ?? null,
		createdAt: record.createdAt.toISOString(),
	};
}
