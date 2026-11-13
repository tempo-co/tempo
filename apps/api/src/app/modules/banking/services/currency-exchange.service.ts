import {Injectable, Logger} from '@nestjs/common';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {safeErrorName} from '../banking.utils';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import {recomputeCurrencyExchanges} from '../currency-exchange/currency-exchange-recompute';

@Injectable()
export class CurrencyExchangeService {
	private readonly logger = new Logger(CurrencyExchangeService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly categorizationService: CategorizationScheduler,
	) {}

	/** Recomputes the owner's exchanges and returns how many rows changed. */
	async recomputeForOwner(ownerId: Account['id']): Promise<number> {
		const {transactionsChanged, requeuedIds} = await this.dataSource.transaction((manager) =>
			recomputeCurrencyExchanges(manager, ownerId),
		);
		if (transactionsChanged > 0) {
			this.logger.log(`Currency exchanges recomputed: ${transactionsChanged} transactions changed`);
		}
		await this.enqueueRequeued(requeuedIds);
		return transactionsChanged;
	}

	/** Recomputes after a bank or amount change without failing the caller; the next change recomputes again. */
	async recomputeForOwnerSafely(ownerId: Account['id']): Promise<void> {
		try {
			await this.recomputeForOwner(ownerId);
		} catch (error) {
			this.logger.warn(`Currency exchange recompute failed: ${safeErrorName(error)}`);
		}
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
