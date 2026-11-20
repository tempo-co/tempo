import {Injectable, Logger} from '@nestjs/common';

import {Account} from '@modules/account/account.entity';

import {safeErrorName} from '../banking.utils';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import {MerchantLogoService} from '../merchant-logos/merchant-logo.service';
import {CurrencyExchangeService} from './currency-exchange.service';
import {OwnTransferService} from './own-transfer.service';
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
	| {kind: 'removal'};

type RefreshPlan = {
	/** Reconcile the reporting currency, telling it whether the history is settled; null skips the reconcile. */
	reconcile: {historySettled: boolean} | null;
	/** Whether to recompute currency exchanges before own transfers. */
	exchanges: boolean;
	/** The rows own transfers can have changed around besides the reclassified exchanges; null is the whole history. */
	ownTransferIds: readonly string[] | null;
	/** Rows to queue for categorization; merchant logos are queued only when there are any. */
	writtenIds: readonly string[];
	/** The rows to queue for merchant logos; null is the owner's whole history. */
	logoIds: readonly string[] | null;
};

function planRefresh(change: DerivedDataChange): RefreshPlan {
	switch (change.kind) {
		case 'sync-write':
			return {
				// The run finished, so the owner can be asked to choose among several currencies now.
				reconcile: {historySettled: true},
				exchanges: true,
				ownTransferIds: [...change.writtenIds, ...change.formerCounterpartIds],
				writtenIds: change.writtenIds,
				logoIds: change.writtenIds,
			};
		case 'failed-sync-write':
			return {reconcile: null, exchanges: true, ownTransferIds: null, writtenIds: [], logoIds: []};
		case 'file-write':
			return {
				// An import can add accounts in another currency, and its history is complete once it commits.
				reconcile: {historySettled: true},
				exchanges: true,
				ownTransferIds: null,
				writtenIds: change.writtenIds,
				logoIds: null,
			};
		case 'authorization':
		case 'removal':
			return {
				// Accounts that all hold one currency set it right away; a choice among several waits for a sync.
				reconcile: {historySettled: false},
				exchanges: false,
				ownTransferIds: null,
				writtenIds: [],
				logoIds: [],
			};
	}
}

/**
 * Brings the values derived from an owner's transaction history up to date after a write has committed. Each step
 * tolerates the failure of an earlier one; the daily whole-history recompute corrects anything a failure left behind.
 */
@Injectable()
export class DerivedDataRefreshService {
	private readonly logger = new Logger(DerivedDataRefreshService.name);

	constructor(
		private readonly reportingCurrencyService: ReportingCurrencyService,
		private readonly currencyExchangeService: CurrencyExchangeService,
		private readonly ownTransferService: OwnTransferService,
		private readonly categorizationService: CategorizationScheduler,
		private readonly merchantLogoService: MerchantLogoService,
	) {}

	async refresh(ownerId: Account['id'], change: DerivedDataChange): Promise<void> {
		const plan = planRefresh(change);
		if (plan.reconcile) await this.reportingCurrencyService.reconcileSafely(ownerId, plan.reconcile);
		// Exchanges go first: own-transfer detection skips exchange legs. Both run before the enqueues, so new exchanges
		// and own transfers are marked before the worker can claim them.
		const reclassifiedIds = plan.exchanges
			? await this.currencyExchangeService.recomputeForOwnerSafely(ownerId)
			: null;
		// Own transfers can only change around the given rows and the rows whose exchange classification changed, so a
		// write that changed none of them does no own-transfer work. A failed exchange recompute leaves the changed rows
		// unknown.
		await this.ownTransferService.recomputeForOwnerSafely(
			ownerId,
			plan.ownTransferIds && reclassifiedIds
				? {transactionIds: [...new Set([...plan.ownTransferIds, ...reclassifiedIds])]}
				: undefined,
		);
		if (plan.writtenIds.length === 0) return;
		await this.enqueueCategorization(plan.writtenIds);
		await this.merchantLogoService.enqueueForOwnerSafely(ownerId, plan.logoIds ?? undefined);
	}

	private async enqueueCategorization(transactionIds: readonly string[]): Promise<void> {
		try {
			await this.categorizationService.enqueueForTransactions(transactionIds);
		} catch (error) {
			this.logger.warn(`Transaction categorization enqueue failed: ${safeErrorName(error)}`);
		}
	}
}
