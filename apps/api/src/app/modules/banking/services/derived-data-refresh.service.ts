import {Injectable, Logger} from '@nestjs/common';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {safeErrorName} from '../banking.utils';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import {recomputeCurrencyExchanges} from '../currency-exchange/currency-exchange-recompute';
import {MerchantLogoService} from '../merchant-logos/merchant-logo.service';
import {recomputeOwnTransfersAndCategories} from '../own-transfer/own-transfer-category';
import type {OwnTransferRecomputeScope} from '../own-transfer/own-transfer-recompute';
import {ReportingCurrencyService} from './reporting-currency.service';

/** What a write to an owner's transaction history changed, as the derived-data refresh needs to know it. */
export type DerivedDataChange =
	| {
			/** A committed sync: the rows it wrote and the former counterparts of the pending rows it removed. */
			kind: 'sync-write';
			writtenIds: readonly string[];
			formerCounterpartIds: readonly string[];
	  }
	/** A sync write that threw: its rows may have committed even so, and which ones is unknown. */
	| {kind: 'failed-sync-write'}
	/** A committed statement file import, doubtful-row resolution, never-sent-row addition or import undo. */
	| {kind: 'file-write'; writtenIds: readonly string[]}
	/** A bank authorization that committed a connection: account IBANs and currencies may have changed. */
	| {kind: 'authorization'}
	/** A committed connection removal: accounts may be gone, or moved onto the imported-files connection. */
	| {kind: 'removal'}
	/** A committed amount-conversion pass for the owner. */
	| {kind: 'converted-amounts'; amountsConverted: boolean; reportingCurrencyChanged: boolean};

type RefreshPlan = {
	/** Reconcile the reporting currency, telling it whether the history is settled; null skips the reconcile. */
	reconcile: {historySettled: boolean} | null;
	/**
	 * The rows own transfers can have changed around besides the reclassified exchanges; null is the whole history, and
	 * `if-reclassified` the whole history only when the exchange recompute reclassified a row or failed.
	 */
	ownTransferIds: readonly string[] | null | 'if-reclassified';
	/** Rows to queue for categorization; merchant logos are queued only when there are any. */
	writtenIds: readonly string[];
	/** The rows to queue for merchant logos; null is the owner's whole history. */
	logoIds: readonly string[] | null;
};

/** The steps the change needs, or null when it needs none. */
function planRefresh(change: DerivedDataChange): RefreshPlan | null {
	switch (change.kind) {
		case 'sync-write':
			return {
				// The run finished, so the owner can be asked to choose among several currencies now.
				reconcile: {historySettled: true},
				ownTransferIds: [...change.writtenIds, ...change.formerCounterpartIds],
				writtenIds: change.writtenIds,
				logoIds: change.writtenIds,
			};
		case 'failed-sync-write':
			return {reconcile: null, ownTransferIds: null, writtenIds: [], logoIds: []};
		case 'file-write':
			return {
				// An import can add accounts in another currency, and its history is complete once it commits.
				reconcile: {historySettled: true},
				ownTransferIds: null,
				writtenIds: change.writtenIds,
				logoIds: null,
			};
		case 'authorization':
		case 'removal':
			return {
				// Accounts that all hold one currency set it right away; a choice among several waits for a sync.
				reconcile: {historySettled: false},
				// Moved accounts change which legs share a connection, so exchanges can pair or part.
				ownTransferIds: null,
				writtenIds: [],
				logoIds: [],
			};
		case 'converted-amounts':
			// Same-day exchanges are matched on converted amounts, so new ones can complete a pairing, and a reporting
			// currency change replaced them all. Own-transfer detection reads no converted amount, only whether a row is an
			// exchange leg.
			if (!change.amountsConverted && !change.reportingCurrencyChanged) return null;
			return {
				reconcile: null,
				ownTransferIds: 'if-reclassified',
				writtenIds: [],
				logoIds: [],
			};
	}
}

/**
 * The own-transfer recompute's scope given the exchange recompute's reclassified rows (null when it failed or did not
 * run), or `skip` when own transfers cannot have changed.
 */
function ownTransferScope(
	ownTransferIds: RefreshPlan['ownTransferIds'],
	reclassifiedIds: readonly string[] | null,
): OwnTransferRecomputeScope | undefined | 'skip' {
	if (ownTransferIds === null) return undefined;
	// A failed exchange recompute may still have committed, so which rows it reclassified is unknown.
	if (reclassifiedIds === null) return undefined;
	if (ownTransferIds === 'if-reclassified') return reclassifiedIds.length > 0 ? undefined : 'skip';
	return {transactionIds: [...new Set([...ownTransferIds, ...reclassifiedIds])]};
}

/**
 * Brings the values derived from an owner's transaction history up to date after a write has committed. Each step
 * tolerates the failure of an earlier one; the daily whole-history recompute corrects the own transfers a failure left
 * behind, and the owner's next refresh the exchanges.
 */
@Injectable()
export class DerivedDataRefreshService {
	private readonly logger = new Logger(DerivedDataRefreshService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly reportingCurrencyService: ReportingCurrencyService,
		private readonly categorizationService: CategorizationScheduler,
		private readonly merchantLogoService: MerchantLogoService,
	) {}

	async refresh(ownerId: Account['id'], change: DerivedDataChange): Promise<void> {
		const plan = planRefresh(change);
		if (!plan) return;
		if (plan.reconcile) await this.reportingCurrencyService.reconcileSafely(ownerId, plan.reconcile);
		await this.recomputeLabels(ownerId, plan.ownTransferIds, plan.writtenIds);
		if (plan.writtenIds.length === 0) return;
		await this.merchantLogoService.enqueueForOwnerSafely(ownerId, plan.logoIds ?? undefined);
	}

	/**
	 * Daily safety net: recomputes every owner's own transfers over the whole history, so a change no scoped recompute
	 * saw (a crash between a sync's commit and its refresh, a write whose commit was not acknowledged) is corrected
	 * within a day.
	 */
	async recomputeAllOwnTransfers(): Promise<void> {
		const owners: Array<{accountId: string}> = await this.dataSource.query(
			'SELECT DISTINCT "accountId" FROM "bank_connections" ORDER BY "accountId"',
		);
		for (const {accountId} of owners) await this.recomputeOwnTransfers(accountId);
	}

	/**
	 * Recomputes exchanges, then own transfers, then queues the written rows and the former exchange legs for
	 * categorization. Exchanges go first: own-transfer detection skips exchange legs. Both run before the enqueue, so
	 * new exchanges and own transfers are labelled before the worker can claim a row.
	 */
	private async recomputeLabels(
		ownerId: Account['id'],
		ownTransferIds: RefreshPlan['ownTransferIds'],
		writtenIds: readonly string[],
	): Promise<void> {
		const exchanges = await this.recomputeExchanges(ownerId);
		// Own transfers can only change around the given rows and the rows whose exchange classification changed, so a
		// write that changed none of them does no own-transfer work.
		const scope = ownTransferScope(ownTransferIds, exchanges?.reclassifiedIds ?? null);
		if (scope !== 'skip') await this.recomputeOwnTransfers(ownerId, scope);
		// Rows that stopped being exchanges go back to the model.
		await this.enqueueCategorization([...writtenIds, ...(exchanges?.requeuedIds ?? [])], 'Transaction');
	}

	/**
	 * Returns the rows that became or stopped being exchanges (`reclassifiedIds`) and those that need a category again
	 * (`requeuedIds`), or null when the recompute failed: it may still have committed, so which rows changed is unknown.
	 */
	private async recomputeExchanges(
		ownerId: Account['id'],
	): Promise<{reclassifiedIds: string[]; requeuedIds: string[]} | null> {
		try {
			const result = await this.dataSource.transaction((manager) => recomputeCurrencyExchanges(manager, ownerId));
			if (result.transactionsChanged > 0) {
				this.logger.log(`Currency exchanges recomputed: ${result.transactionsChanged} transactions changed`);
			}
			return {reclassifiedIds: result.reclassifiedIds, requeuedIds: result.requeuedIds};
		} catch (error) {
			this.logger.warn(`Currency exchange recompute failed: ${safeErrorName(error)}`);
			return null;
		}
	}

	/** A failed scoped recompute is retried over the whole history; a failed whole-history one waits for the next day. */
	private async recomputeOwnTransfers(ownerId: Account['id'], scope?: OwnTransferRecomputeScope): Promise<void> {
		try {
			await this.recomputeOwnTransfersOnce(ownerId, scope);
			return;
		} catch (error) {
			this.logger.warn(`Own-transfer recompute failed: ${safeErrorName(error)}`);
			if (!scope) return;
		}
		try {
			await this.recomputeOwnTransfersOnce(ownerId);
		} catch (error) {
			this.logger.warn(`Own-transfer recompute failed: ${safeErrorName(error)}`);
		}
	}

	private async recomputeOwnTransfersOnce(ownerId: Account['id'], scope?: OwnTransferRecomputeScope): Promise<void> {
		if (scope?.transactionIds.length === 0) return;
		const startedAt = Date.now();
		const {result, requeuedIds} = await this.dataSource.transaction((manager) =>
			recomputeOwnTransfersAndCategories(manager, ownerId, scope),
		);
		// Rows that stopped being own transfers go back to the model once the transaction has committed.
		await this.enqueueCategorization(requeuedIds, 'Former own-transfer');
		if (result.transactionsChanged > 0 || result.accountIbansAdded > 0) {
			this.logger.log(
				`Own transfers recomputed${scope ? ' in scope' : ''}: ${result.transactionsChanged} transactions ` +
					`changed, ${result.accountIbansAdded} account IBANs added in ${Date.now() - startedAt} ms`,
			);
		}
	}

	private async enqueueCategorization(transactionIds: readonly string[], rows: string): Promise<void> {
		if (transactionIds.length === 0) return;
		try {
			await this.categorizationService.enqueueForTransactions(transactionIds);
		} catch (error) {
			this.logger.warn(`${rows} categorization enqueue failed: ${safeErrorName(error)}`);
		}
	}
}
