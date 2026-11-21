import {ConflictException, Injectable, Logger} from '@nestjs/common';
import {DataSource, EntityManager} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankConnection} from '../bank-connection.entity';
import {safeErrorName} from '../banking.utils';
import {AccountHistoryWriteBusyError} from '../errors/account-history-write-busy.error';
import {lockReportingCurrencyForAmountWrites} from '../reporting-currency';
import {BankingConnectionLock, BankingConnectionLockService} from './banking-connection-lock.service';
import {BANK_CONNECTION_PROVIDERS} from './banking-sync.constants';
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
