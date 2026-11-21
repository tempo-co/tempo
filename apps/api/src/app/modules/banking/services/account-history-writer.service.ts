import {ConflictException, Injectable, Logger} from '@nestjs/common';
import {DataSource, EntityManager} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import type {EnableBankingTransaction, EnableBankingTransactionFetchOptions} from '../enable-banking.types';
import {AccountHistoryWriteBusyError} from '../errors/account-history-write-busy.error';
import {lockReportingCurrencyForAmountWrites} from '../reporting-currency';
import {FinalSyncDays, extendSyncCoverage, finalSyncDays, recordsSyncCoverage} from '../sync-coverage';
import {BankTransactionPersistenceService} from './bank-transaction-persistence.service';
import {BankingConnectionLock, BankingConnectionLockService} from './banking-connection-lock.service';
import {BANK_CONNECTION_PROVIDERS} from './banking-sync.constants';
import type {DerivedDataChange} from './derived-data-refresh.service';
import {lockFileConnection} from './file-connection';

/** How long a write waits for a sync of a connection it writes to, then refuses as busy. */
const SYNC_LEASE_WAIT_MS = 10_000;

export type AccountHistoryWriteLocks = {
	/** Synced connections the write changes, whose sync lease it takes. A sync run passes none: it holds its own. */
	syncedConnectionIds?: readonly BankConnection['id'][];
	/** The owner's imported-files connection, locked for the write: `create` makes it when missing. */
	fileConnection?: 'create' | 'existing';
};

export type AccountHistoryWrite = {
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

/**
 * Opens every write to an owner's transaction history (sync, import, doubtful and never-sent rows, undo) with its
 * locks taken in one order: the sync leases of the synced connections, in id order; then, in the transaction, the
 * reporting-currency lock as its first statement and the imported-files connection; then whatever the work locks
 * (an import record and its connection). Connection removal and authorization lock the imported-files connection
 * before the bank's connections too.
 */
@Injectable()
export class AccountHistoryWriterService {
	private readonly logger = new Logger(AccountHistoryWriterService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly connectionLockService: BankingConnectionLockService,
		private readonly persistence: BankTransactionPersistenceService,
	) {}

	/** Runs the work in one transaction under the write's locks; a lease not had in time refuses it as busy. */
	async write<T>(
		ownerId: Account['id'],
		{syncedConnectionIds = [], fileConnection}: AccountHistoryWriteLocks,
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
							? await manager.getRepository(BankConnection).findOne({
									where: {accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
									lock: {mode: 'pessimistic_write'},
								})
							: null;
				const result = await work({manager, fileConnection: locked});
				for (const lease of leases) lease.assertHealthy();
				return result;
			});
		} finally {
			await this.releaseLeases(leases);
		}
	}

	/**
	 * Records one account's bank fetch inside the write, in order: stores the rows by identity (taking over the
	 * imported rows they land on); after a complete fetch, removes the pending rows of its window it did not return;
	 * extends the account's coverage when the provider records any; removes the imported rows the bank never sent from
	 * the days sync is now final for; and moves the watermark when every page came.
	 */
	async recordBankFetch({manager}: AccountHistoryWrite, fetch: BankFetch): Promise<RecordedBankFetch> {
		const {bankAccount, connection} = fetch;
		const transactions = manager.getRepository(BankTransaction);
		const accounts = manager.getRepository(BankAccount);
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
				bankAccount,
				fetch.transactions,
				connection.aspspName,
				recordsCoverage ? coverage : null,
			);
			transactionsAdded = persisted.transactionsAdded;
			writtenIds = persisted.persistedTransactionIds;
			takenOverImportedIds = persisted.takenOverImportedIds;
		}

		if (fetch.complete) {
			formerCounterpartIds.push(
				...(await this.persistence.removeUnreturnedPendingTransactions(
					transactions,
					bankAccount.id,
					writtenIds,
					fetch.fetchOptions.dateFrom ?? null,
				)),
			);
			if (recordsCoverage && coverage) {
				await accounts.update(
					{id: bankAccount.id},
					{syncCoveredFrom: coverage.from, syncCoveredThrough: coverage.through},
				);
				// Sync is final for these days now: imported rows there it never sent go.
				const finalDays = await this.findFinalSyncDays(manager, {
					id: bankAccount.id,
					syncCoveredFrom: coverage.from,
					syncCoveredThrough: coverage.through,
					bankConnection: connection,
				});
				if (finalDays) {
					const swept = await this.persistence.sweepImportedRows(
						transactions,
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
			await accounts.update({id: bankAccount.id}, {transactionsFetchedThrough: fetch.fetchedThrough});
		}

		return {
			transactionsAdded,
			change: {kind: 'sync-write', writtenIds, formerCounterpartIds: [...new Set(formerCounterpartIds)]},
		};
	}

	/**
	 * The days bank sync is final for on the account (`finalSyncDays`), from its coverage and the pending rows stored
	 * now: sync reads again from the oldest one, so the days from it on are not final. Null for an account without
	 * coverage or on a provider that records none.
	 */
	async findFinalSyncDays(
		manager: EntityManager,
		account: Pick<BankAccount, 'id' | 'syncCoveredFrom' | 'syncCoveredThrough'> & {
			bankConnection: Pick<BankConnection, 'provider'>;
		},
	): Promise<FinalSyncDays | null> {
		if (!account.syncCoveredFrom || !account.syncCoveredThrough) return null;
		const pendingStarts = await this.persistence.findPendingTransactionStarts(
			manager.getRepository(BankTransaction),
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
