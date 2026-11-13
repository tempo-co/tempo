import {Injectable, Logger} from '@nestjs/common';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {safeErrorName} from '../banking.utils';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import {applyOwnTransferCategories} from '../own-transfer/own-transfer-category';
import type {OwnTransferOverride} from '../own-transfer/own-transfer-detection';
import {
	OwnTransferRecomputeResult,
	OwnTransferRecomputeScope,
	lockOwnTransfers,
	recomputeOwnTransfers,
} from '../own-transfer/own-transfer-recompute';

@Injectable()
export class OwnTransferService {
	private readonly logger = new Logger(OwnTransferService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly categorizationService: CategorizationScheduler,
	) {}

	/**
	 * Recomputes the owner's own transfers over the whole history, or with a scope only around the rows a sync just
	 * wrote. An empty scope does nothing.
	 */
	async recomputeForOwner(
		ownerId: Account['id'],
		scope?: OwnTransferRecomputeScope,
	): Promise<OwnTransferRecomputeResult> {
		if (scope?.transactionIds.length === 0) return {accountIbansAdded: 0, transactionsChanged: 0, changedIds: []};
		const startedAt = Date.now();
		const {result, requeuedIds} = await this.dataSource.transaction(async (manager) => {
			const recomputed = await recomputeOwnTransfers(manager, ownerId, scope);
			// In scope only the scoped rows and the rows whose evidence changed can need a new category.
			const categoryIds = scope && [...new Set([...scope.transactionIds, ...recomputed.changedIds])];
			return {result: recomputed, requeuedIds: await applyOwnTransferCategories(manager, ownerId, categoryIds)};
		});
		await this.enqueueRequeued(requeuedIds);
		if (result.transactionsChanged > 0 || result.accountIbansAdded > 0) {
			this.logger.log(
				`Own transfers recomputed${scope ? ' in scope' : ''}: ${result.transactionsChanged} transactions ` +
					`changed, ${result.accountIbansAdded} account IBANs added in ${Date.now() - startedAt} ms`,
			);
		}
		return result;
	}

	/**
	 * Stores the owner's decision for one transaction and recomputes the whole history in the same transaction, so
	 * both legs of a pair change together. Returns false when the transaction is not the owner's.
	 */
	async updateOverride(
		ownerId: Account['id'],
		transactionId: string,
		override: OwnTransferOverride | null,
	): Promise<boolean> {
		const requeuedIds = await this.dataSource.transaction(async (manager) => {
			await lockOwnTransfers(manager, ownerId);
			const [updated] = (await manager.query(
				`UPDATE "bank_transactions" transaction SET "ownTransferOverride" = $1
				FROM "bank_accounts" account, "bank_connections" connection
				WHERE transaction."id" = $2 AND account."id" = transaction."bankAccountId"
					AND connection."id" = account."bankConnectionId" AND connection."accountId" = $3
				RETURNING transaction."id"`,
				[override, transactionId, ownerId],
			)) as [unknown[], number];
			if (updated.length === 0) return null;

			await recomputeOwnTransfers(manager, ownerId);
			return applyOwnTransferCategories(manager, ownerId);
		});
		if (requeuedIds === null) return false;
		await this.enqueueRequeued(requeuedIds);
		return true;
	}

	/** Rows that stopped being own transfers go back to the model once the transaction has committed. */
	private async enqueueRequeued(ids: readonly string[]): Promise<void> {
		if (ids.length === 0) return;
		try {
			await this.categorizationService.enqueueForTransactions(ids);
		} catch (error) {
			this.logger.warn(`Former own-transfer categorization enqueue failed: ${safeErrorName(error)}`);
		}
	}

	/**
	 * Recomputes after a bank change without failing the caller. A failed scoped recompute is retried over the whole
	 * history; anything still missed is corrected by the daily whole-history recompute.
	 */
	async recomputeForOwnerSafely(ownerId: Account['id'], scope?: OwnTransferRecomputeScope): Promise<void> {
		try {
			await this.recomputeForOwner(ownerId, scope);
			return;
		} catch (error) {
			this.logger.warn(`Own-transfer recompute failed: ${safeErrorName(error)}`);
			if (!scope) return;
		}
		try {
			await this.recomputeForOwner(ownerId);
		} catch (error) {
			this.logger.warn(`Own-transfer recompute failed: ${safeErrorName(error)}`);
		}
	}

	/**
	 * Daily safety net: recomputes every owner's whole history, so a change no scoped recompute saw (a crash between a
	 * sync's commit and its recompute, a write whose commit was not acknowledged) is corrected within a day.
	 */
	async recomputeAllOwners(): Promise<void> {
		const owners: Array<{accountId: string}> = await this.dataSource.query(
			'SELECT DISTINCT "accountId" FROM "bank_connections"',
		);
		for (const {accountId} of owners) await this.recomputeForOwnerSafely(accountId);
	}
}
