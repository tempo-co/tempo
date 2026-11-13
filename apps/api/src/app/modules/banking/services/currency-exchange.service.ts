import {Injectable, Logger} from '@nestjs/common';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {safeErrorName} from '../banking.utils';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import {
	CurrencyExchangeRecomputeResult,
	recomputeCurrencyExchanges,
} from '../currency-exchange/currency-exchange-recompute';

@Injectable()
export class CurrencyExchangeService {
	private readonly logger = new Logger(CurrencyExchangeService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly categorizationService: CategorizationScheduler,
	) {}

	/** Recomputes the owner's exchanges and returns how many rows changed. */
	async recomputeForOwner(ownerId: Account['id']): Promise<number> {
		return (await this.recompute(ownerId)).transactionsChanged;
	}

	/**
	 * Recomputes after a bank or amount change without failing the caller; the next change recomputes again. Returns
	 * the rows that became or stopped being exchanges, so the caller can recompute own transfers for them, or null when
	 * the recompute failed: it may still have committed, so which rows changed is unknown.
	 */
	async recomputeForOwnerSafely(ownerId: Account['id']): Promise<string[] | null> {
		try {
			return (await this.recompute(ownerId)).reclassifiedIds;
		} catch (error) {
			this.logger.warn(`Currency exchange recompute failed: ${safeErrorName(error)}`);
			return null;
		}
	}

	private async recompute(ownerId: Account['id']): Promise<CurrencyExchangeRecomputeResult> {
		const result = await this.dataSource.transaction((manager) => recomputeCurrencyExchanges(manager, ownerId));
		if (result.transactionsChanged > 0) {
			this.logger.log(`Currency exchanges recomputed: ${result.transactionsChanged} transactions changed`);
		}
		await this.enqueueRequeued(result.requeuedIds);
		return result;
	}

	/** Rows that stopped being exchanges go back to the model once the transaction has committed. */
	private async enqueueRequeued(ids: readonly string[]): Promise<void> {
		if (ids.length === 0) return;
		try {
			await this.categorizationService.enqueueForTransactions(ids);
		} catch (error) {
			this.logger.warn(`Former currency exchange categorization enqueue failed: ${safeErrorName(error)}`);
		}
	}
}
