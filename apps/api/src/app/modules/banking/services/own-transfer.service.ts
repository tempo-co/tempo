import {Injectable, Logger} from '@nestjs/common';
import {DataSource, EntityManager} from 'typeorm';

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

type Recomputed = {result: OwnTransferRecomputeResult; requeuedIds: string[]};

@Injectable()
export class OwnTransferService {
	private readonly logger = new Logger(OwnTransferService.name);
	/**
	 * Owners whose stored own transfers this process has seen match a whole-history recompute, with every recompute
	 * since succeeding: only their changes can be recomputed in scope. Anyone else, including every owner after a
	 * restart (a crash can fall between a sync's commit and its recompute), gets the whole history first.
	 */
	private readonly ownersInStep = new Set<Account['id']>();
	/**
	 * Each owner's recomputes run one after another here, each through its bookkeeping, so one decides whether its
	 * scope counts only once the one before it has recorded how it ended. The advisory lock cannot promise that: a
	 * terminated database session frees it before its caller hears of the failure.
	 */
	private readonly ownerQueues = new Map<Account['id'], Promise<unknown>>();

	constructor(
		private readonly dataSource: DataSource,
		private readonly categorizationService: CategorizationScheduler,
	) {}

	/**
	 * Recomputes the owner's own transfers: over the whole history, or with a scope only where the scoped rows can
	 * change the result. An empty scope does nothing. A scope counts only for an owner in step (`ownersInStep`).
	 */
	recomputeForOwner(ownerId: Account['id'], scope?: OwnTransferRecomputeScope): Promise<OwnTransferRecomputeResult> {
		return this.serialize(ownerId, async () => {
			const scoped = this.ownersInStep.has(ownerId) ? scope : undefined;
			if (scoped?.transactionIds.length === 0)
				return {accountIbansAdded: 0, transactionsChanged: 0, changedIds: []};
			const startedAt = Date.now();
			const {result, requeuedIds} = await this.transact(ownerId, (manager) =>
				this.recomputeInTransaction(manager, ownerId, scoped),
			);
			await this.enqueueRequeued(requeuedIds);
			if (result.transactionsChanged > 0 || result.accountIbansAdded > 0) {
				this.logger.log(
					`Own transfers recomputed: ${result.transactionsChanged} transactions changed, ` +
						`${result.accountIbansAdded} account IBANs added in ${Date.now() - startedAt} ms`,
				);
			}
			return result;
		});
	}

	/**
	 * Stores the owner's decision for one transaction and recomputes in the same transaction, so both
	 * legs of a pair change together. Returns false when the transaction is not the owner's.
	 */
	updateOverride(
		ownerId: Account['id'],
		transactionId: string,
		override: OwnTransferOverride | null,
	): Promise<boolean> {
		return this.serialize(ownerId, async () => {
			const inStep = this.ownersInStep.has(ownerId);
			const recomputed = await this.transact(ownerId, async (manager) => {
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

				// The override is the only input that changed.
				return this.recomputeInTransaction(
					manager,
					ownerId,
					inStep ? {transactionIds: [transactionId]} : undefined,
				);
			});
			if (recomputed === null) return false;
			await this.enqueueRequeued(recomputed.requeuedIds);
			return true;
		});
	}

	/**
	 * Makes the owner's next recompute cover the whole history: for a write whose commit outcome is unknown, so the
	 * rows it may have stored are not known either.
	 */
	requireWholeHistory(ownerId: Account['id']): void {
		void this.serialize(ownerId, async () => {
			this.ownersInStep.delete(ownerId);
		});
	}

	/** Runs the task after the owner's previous recompute has finished, whether it succeeded or not. */
	private serialize<T>(ownerId: Account['id'], task: () => Promise<T>): Promise<T> {
		const run = (this.ownerQueues.get(ownerId) ?? Promise.resolve()).then(task);
		const settled = run.catch(() => undefined);
		this.ownerQueues.set(ownerId, settled);
		void settled.then(() => {
			if (this.ownerQueues.get(ownerId) === settled) this.ownerQueues.delete(ownerId);
		});
		return run;
	}

	/**
	 * Runs one recompute transaction. A committed recompute leaves the owner in step: a whole-history one puts it there,
	 * a scoped one runs only for an owner already in step. A failure takes it out, since the rows the failed recompute
	 * covered are unknown.
	 */
	private async transact<T extends Recomputed | null>(
		ownerId: Account['id'],
		work: (manager: EntityManager) => Promise<T>,
	): Promise<T> {
		try {
			const recomputed = await this.dataSource.transaction(work);
			if (recomputed) this.ownersInStep.add(ownerId);
			return recomputed;
		} catch (error) {
			this.ownersInStep.delete(ownerId);
			throw error;
		}
	}

	private async recomputeInTransaction(
		manager: EntityManager,
		ownerId: Account['id'],
		scope: OwnTransferRecomputeScope | undefined,
	): Promise<Recomputed> {
		const result = await recomputeOwnTransfers(manager, ownerId, scope);
		// In scope only the changed rows and the rows whose evidence changed can need a new category.
		const categoryIds = scope && [...new Set([...scope.transactionIds, ...result.changedIds])];
		return {result, requeuedIds: await applyOwnTransferCategories(manager, ownerId, categoryIds)};
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
	 * Recomputes after a bank change without failing the caller. After a failure the owner's next recompute covers the
	 * whole history, so the rows this one missed are not lost.
	 */
	async recomputeForOwnerSafely(ownerId: Account['id'], scope?: OwnTransferRecomputeScope): Promise<void> {
		try {
			await this.recomputeForOwner(ownerId, scope);
		} catch (error) {
			this.logger.warn(`Own-transfer recompute failed: ${safeErrorName(error)}`);
		}
	}
}
