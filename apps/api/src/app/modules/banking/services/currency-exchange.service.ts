import {Injectable, Logger} from '@nestjs/common';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {safeErrorName} from '../banking.utils';
import {recomputeCurrencyExchanges} from '../currency-exchange/currency-exchange-recompute';

@Injectable()
export class CurrencyExchangeService {
	private readonly logger = new Logger(CurrencyExchangeService.name);

	constructor(private readonly dataSource: DataSource) {}

	async recomputeForOwner(ownerId: Account['id']): Promise<number> {
		const changed = await this.dataSource.transaction((manager) => recomputeCurrencyExchanges(manager, ownerId));
		if (changed > 0) this.logger.log(`Currency exchange pairs recomputed: ${changed} transactions changed`);
		return changed;
	}

	/** Recomputes after a bank or amount change without failing the caller; the next change recomputes again. */
	async recomputeForOwnerSafely(ownerId: Account['id']): Promise<void> {
		try {
			await this.recomputeForOwner(ownerId);
		} catch (error) {
			this.logger.warn(`Currency exchange recompute failed: ${safeErrorName(error)}`);
		}
	}
}
