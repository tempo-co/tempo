import {ConflictException, Injectable, Logger} from '@nestjs/common';
import {DataSource, EntityManager} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import {clearStaleConvertedAmounts, copySameCurrencyAmounts} from '../converted-amounts';
import type {EnableBankingTransaction, EnableBankingTransactionFetchOptions} from '../enable-banking.types';
import {AccountHistoryWriteBusyError} from '../errors/account-history-write-busy.error';
import {lockReportingCurrencyForAmountWrites} from '../reporting-currency';
import {FinalSyncDays, extendSyncCoverage, finalSyncDays, isFinalSyncDay, recordsSyncCoverage} from '../sync-coverage';
import {
	BankTransactionInput,
	BankTransactionPersistenceService,
	ImportedTransactionsTarget,
} from './bank-transaction-persistence.service';
import {BankingConnectionLock, BankingConnectionLockService} from './banking-connection-lock.service';
import type {DerivedDataChange} from './derived-data-refresh.service';
import {FileAccountBalance, FileAccountBalanceService} from './file-account-balance.service';
import {lockExistingFileConnection, lockFileConnection} from './file-connection';

/** How long a write waits for a sync of a connection it writes to, then refuses as busy. */
const SYNC_LEASE_WAIT_MS = 10_000;

export type AccountHistoryWriteLocks = {
	/** Synced connections the write changes, whose sync lease it takes. A sync run passes none: it holds its own. */
	syncedConnectionIds?: readonly BankConnection['id'][];
	/** Sync leases the caller already holds, as a sync run its own: checked before commit, neither taken nor released. */
	heldLeases?: readonly BankingConnectionLock[];
	/** The owner's imported-files connection, locked for the write: `create` makes it when missing. */
	fileConnection?: 'create' | 'existing';
};

export type AccountHistoryWrite = {
	ownerId: Account['id'];
	manager: EntityManager;
	/** The locked imported-files connection when asked for; null when the owner has none (`existing`) or it went. */
	fileConnection: BankConnection | null;
};

/** One account's transactions fetch in a sync run, as the run recorded it. */
export type BankFetch = {
	/** The account as the run found it, with its stored coverage. */
	bankAccount: BankAccount;
	connection: Pick<BankConnection, 'provider' | 'aspspName'>;
	/** Every fetched row; after a failed later page, the rows of the pages before it. */
	transactions: readonly EnableBankingTransaction[];
	/** What the transactions call asked for. */
	fetchOptions: EnableBankingTransactionFetchOptions;
	/** Every transaction page was fetched, so the account's watermark may advance. */
	succeeded: boolean;
	/** Every page was fetched and every row read, so pending rows the fetch did not return are gone. */
	complete: boolean;
	/** The date a complete fetch covers, in the app's time zone. */
	fetchedThrough: string;
};

export type RecordedBankFetch = {
	/** Rows the fetch inserted; the others already existed and were updated. */
	transactionsAdded: number;
	change: Extract<DerivedDataChange, {kind: 'sync-write'}>;
};

/** The account a file write adds rows to, and the import they become rows of. */
export type FileRowsTarget = {
	/** The account as read inside the write. */
	account: BankAccount;
	connection: Pick<BankConnection, 'provider' | 'aspspName'>;
	importId: ImportedTransactionsTarget['importId'];
};

/**
 * What adding file rows does with a row on a day bank sync is final for: `drop` it, as sync sent every payment of that
 * day, or `add` it, for a row the owner chose to add (a never-sent row, a doubtful row answered `new`).
 */
export type OnFinalSyncDays = 'drop' | 'add';

/** What adding file rows offers the caller's work on the account. */
export type FileRowsWrite = {
	/**
	 * The days bank sync is final for on the account, as the write's locks hold them (`findFinalSyncDays`), so the
	 * work can record the rows it leaves out there.
	 */
	finalDays: FinalSyncDays | null;
	/**
	 * Inserts the rows as new rows of the import, listed in the given order, and returns their ids in that order. A row
	 * on a final day (`fileRowDay`) is left out unless the write adds them (`OnFinalSyncDays`).
	 */
	insert: (
		transactions: readonly BankTransactionInput[],
		numbering: Pick<ImportedTransactionsTarget, 'statementNumbering'>,
	) => Promise<string[]>;
};

export type AddedFileRows<T> = {
	result: T;
	/** An imported-files account's balance after the rows; null for an account of a synced connection. */
	balance: FileAccountBalance | null;
	change: Extract<DerivedDataChange, {kind: 'file-write'}>;
};

/**
 * Opens every write to an owner's transaction history (sync, import, doubtful and never-sent rows, undo) with its
 * locks taken in one order: the sync leases of the synced connections, in id order; then, in the transaction, the
 * reporting-currency lock as its first statement, and the owner's account row and imported-files connection when the
 * write asks for it; then whatever the work locks (an import record and its connection). Account deletion, connection
 * removal and authorization lock the account row, then the imported-files connection, before the bank's connections.
 */
@Injectable()
export class AccountHistoryWriterService {
	private readonly logger = new Logger(AccountHistoryWriterService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly connectionLockService: BankingConnectionLockService,
		private readonly persistence: BankTransactionPersistenceService,
		private readonly fileAccountBalanceService: FileAccountBalanceService,
	) {}

	/** Runs the work in one transaction under the write's locks; a lease not had in time refuses it as busy. */
	async write<T>(
		ownerId: Account['id'],
		{syncedConnectionIds = [], heldLeases = [], fileConnection}: AccountHistoryWriteLocks,
		work: (write: AccountHistoryWrite) => Promise<T>,
	): Promise<T> {
		const leases = await this.takeLeases(syncedConnectionIds);
		try {
			return await this.dataSource.transaction(async (manager) => {
				await lockReportingCurrencyForAmountWrites(manager, ownerId);
				const locked =
					fileConnection === 'create'
						? await lockFileConnection(manager, ownerId)
						: fileConnection === 'existing'
							? await lockExistingFileConnection(manager, ownerId)
							: null;
				const result = await work({ownerId, manager, fileConnection: locked});
				for (const lease of [...heldLeases, ...leases]) lease.assertHealthy();
				return result;
			});
		} finally {
			await this.releaseLeases(leases);
		}
	}

	/**
	 * Records one account's bank fetch inside the write, in order: stores the rows by identity (taking over the
	 * imported rows they land on), clearing converted amounts whose inputs changed and giving rows in the reporting
	 * currency their own amount; after a complete fetch, removes the pending rows of its window it did not return;
	 * extends the account's coverage when the provider records any; removes the imported rows the bank never sent from
	 * the days sync is now final for; and moves the watermark when every page came.
	 */
	async recordBankFetch({ownerId, manager}: AccountHistoryWrite, fetch: BankFetch): Promise<RecordedBankFetch> {
		const {bankAccount, connection} = fetch;
		const transactions = manager.getRepository(BankTransaction);
		const {syncCoveredFrom, syncCoveredThrough} = bankAccount;
		const storedCoverage =
			syncCoveredFrom && syncCoveredThrough ? {from: syncCoveredFrom, through: syncCoveredThrough} : null;
		const recordsCoverage = recordsSyncCoverage(connection.provider);
		// Only a complete fetch extends the coverage.
		const coverage =
			fetch.complete && recordsCoverage
				? extendSyncCoverage(storedCoverage, {
						options: fetch.fetchOptions,
						transactions: fetch.transactions,
						fetchedOn: fetch.fetchedThrough,
					})
				: storedCoverage;

		let transactionsAdded = 0;
		let writtenIds: string[] = [];
		let takenOverImportedIds: string[] = [];
		const formerCounterpartIds: string[] = [];
		if (fetch.transactions.length > 0) {
			const persisted = await this.persistence.persistTransactions(
				transactions,
				ownerId,
				bankAccount,
				fetch.transactions,
				connection.aspspName,
				recordsCoverage ? coverage : null,
			);
			await clearStaleConvertedAmounts(manager, ownerId, bankAccount.id, persisted.previousRows);
			await copySameCurrencyAmounts(manager, ownerId, bankAccount.id);
			transactionsAdded = persisted.transactionsAdded;
			writtenIds = persisted.persistedTransactionIds;
			takenOverImportedIds = persisted.takenOverImportedIds;
		}

		if (fetch.complete) {
			formerCounterpartIds.push(
				...(await this.persistence.removeUnreturnedPendingTransactions(
					transactions,
					ownerId,
					bankAccount.id,
					writtenIds,
					fetch.fetchOptions.dateFrom ?? null,
				)),
			);
			if (recordsCoverage && coverage) {
				await updateOwnedAccount(manager, ownerId, bankAccount.id, {
					syncCoveredFrom: coverage.from,
					syncCoveredThrough: coverage.through,
				});
				// Sync is final for these days now: imported rows there it never sent go.
				const finalDays = await this.findFinalSyncDays(manager, ownerId, {
					id: bankAccount.id,
					syncCoveredFrom: coverage.from,
					syncCoveredThrough: coverage.through,
					bankConnection: connection,
				});
				if (finalDays) {
					const swept = await this.persistence.sweepImportedRows(
						transactions,
						ownerId,
						bankAccount,
						finalDays,
						connection.aspspName,
						takenOverImportedIds,
					);
					formerCounterpartIds.push(...swept.recomputeIds);
				}
			}
		}

		if (fetch.succeeded) {
			await updateOwnedAccount(manager, ownerId, bankAccount.id, {
				transactionsFetchedThrough: fetch.fetchedThrough,
			});
		}

		return {
			transactionsAdded,
			change: {kind: 'sync-write', writtenIds, formerCounterpartIds: [...new Set(formerCounterpartIds)]},
		};
	}

	/**
	 * Adds file rows to one account inside the write, in one call per account and write: the work gets the account's
	 * final sync days, to decide which rows are new, and inserts them as rows of the import, a row in the reporting
	 * currency with its own amount, and none on a final day unless `onFinalDays` adds them. Then an account on the
	 * imported-files connection (one kept when its bank was removed too) has its balance recomputed from its rows; a
	 * synced account keeps the one sync reports.
	 */
	async addFileRows<T>(
		{ownerId, manager}: AccountHistoryWrite,
		{account, connection, importId}: FileRowsTarget,
		work: (rows: FileRowsWrite) => Promise<T>,
		{onFinalDays = 'drop'}: {onFinalDays?: OnFinalSyncDays} = {},
	): Promise<AddedFileRows<T>> {
		const transactions = manager.getRepository(BankTransaction);
		const writtenIds: string[] = [];
		const finalDays = await this.findFinalSyncDays(manager, ownerId, {...account, bankConnection: connection});
		const result = await work({
			finalDays,
			insert: async (given, {statementNumbering}) => {
				const rows =
					onFinalDays === 'add' ? given : given.filter((row) => !isFinalSyncDay(fileRowDay(row), finalDays));
				if (rows.length === 0) return [];
				const {insertedTransactionIds} = await this.persistence.insertImportedTransactions(
					transactions,
					ownerId,
					account,
					rows,
					connection.aspspName,
					{importId, statementNumbering},
				);
				await copySameCurrencyAmounts(manager, ownerId, account.id, insertedTransactionIds);
				writtenIds.push(...insertedTransactionIds);
				return insertedTransactionIds;
			},
		});
		// Decided by the connection the account is on now, which a removal keeping it may have changed since it was read.
		const balance = await this.fileAccountBalanceService.recompute(manager, ownerId, account.id);
		return {result, balance, change: {kind: 'file-write', writtenIds}};
	}

	/**
	 * The days bank sync is final for on the account (`finalSyncDays`), from its coverage and the pending rows stored
	 * now: sync reads again from the oldest one, so the days from it on are not final. Null for an account without
	 * coverage or on a provider that records none.
	 */
	private async findFinalSyncDays(
		manager: EntityManager,
		ownerId: Account['id'],
		account: Pick<BankAccount, 'id' | 'syncCoveredFrom' | 'syncCoveredThrough'> & {
			bankConnection: Pick<BankConnection, 'provider'>;
		},
	): Promise<FinalSyncDays | null> {
		if (!account.syncCoveredFrom || !account.syncCoveredThrough) return null;
		const pendingStarts = await this.persistence.findPendingTransactionStarts(
			manager.getRepository(BankTransaction),
			ownerId,
			[account.id],
		);
		return finalSyncDays({
			provider: account.bankConnection.provider,
			syncCoveredFrom: account.syncCoveredFrom,
			syncCoveredThrough: account.syncCoveredThrough,
			oldestPendingDay: pendingStarts.get(account.id) ?? null,
		});
	}

	private async takeLeases(connectionIds: readonly string[]): Promise<BankingConnectionLock[]> {
		const leases: BankingConnectionLock[] = [];
		try {
			for (const connectionId of [...new Set(connectionIds)].sort()) {
				leases.push(await this.connectionLockService.acquire(connectionId, {waitForMs: SYNC_LEASE_WAIT_MS}));
			}
		} catch (error) {
			await this.releaseLeases(leases);
			if (error instanceof ConflictException) throw new AccountHistoryWriteBusyError();
			throw error;
		}
		return leases;
	}

	private async releaseLeases(leases: readonly BankingConnectionLock[]): Promise<void> {
		for (const lease of leases) {
			lease.stop();
			try {
				await lease.release();
			} catch (error) {
				this.logger.warn(`Account history lease release failed: ${safeErrorName(error)}`);
			}
		}
	}
}

/**
 * A file row's day as file import matches it (`matchDay`): its booking date, or its value date when the statement gave
 * none, so a booking date filled in from the transaction date does not count.
 */
function fileRowDay(row: BankTransactionInput): string | null {
	return (row.bookingDateFilled ? null : row.bookingDate) ?? row.valueDate ?? null;
}

/** Updates one of the owner's accounts, as a repository update does, its `updatedAt` too. */
async function updateOwnedAccount(
	manager: EntityManager,
	ownerId: Account['id'],
	bankAccountId: BankAccount['id'],
	values: Partial<Pick<BankAccount, 'syncCoveredFrom' | 'syncCoveredThrough' | 'transactionsFetchedThrough'>>,
): Promise<void> {
	const entries = Object.entries(values);
	await manager.query(
		`UPDATE "bank_accounts" bank_account
		SET ${entries.map(([column], index) => `"${column}" = $${index + 3}`).join(', ')}, "updatedAt" = CURRENT_TIMESTAMP
		FROM "bank_connections" connection
		WHERE bank_account."id" = $1 AND connection."id" = bank_account."bankConnectionId" AND connection."accountId" = $2`,
		[bankAccountId, ownerId, ...entries.map(([, value]) => value)],
	);
}
