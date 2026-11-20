import {Injectable, Logger} from '@nestjs/common';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {safeErrorName} from '../banking.utils';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import {recomputeOwnTransfersAndCategories} from '../own-transfer/own-transfer-category';
import type {OwnTransferOverride} from '../own-transfer/own-transfer-detection';
import {lockOwnTransfers} from '../own-transfer/own-transfer-recompute';

/** The owner's own-transfer decisions; recomputes after history writes run in the derived-data refresh. */
@Injectable()
export class OwnTransferService {
	private readonly logger = new Logger(OwnTransferService.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly categorizationService: CategorizationScheduler,
	) {}

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
			const [updated] = await manager.query<[unknown[], number]>(
				`UPDATE "bank_transactions" transaction SET "ownTransferOverride" = $1
				FROM "bank_accounts" account, "bank_connections" connection
				WHERE transaction."id" = $2 AND account."id" = transaction."bankAccountId"
					AND connection."id" = account."bankConnectionId" AND connection."accountId" = $3
				RETURNING transaction."id"`,
				[override, transactionId, ownerId],
			);
			if (updated.length === 0) return null;

			return (await recomputeOwnTransfersAndCategories(manager, ownerId)).requeuedIds;
		});
		if (requeuedIds === null) return false;
		// Rows that stopped being own transfers go back to the model once the transaction has committed.
		if (requeuedIds.length === 0) return true;
		try {
			await this.categorizationService.enqueueForTransactions(requeuedIds);
		} catch (error) {
			this.logger.warn(`Former own-transfer categorization enqueue failed: ${safeErrorName(error)}`);
		}
		return true;
	}
}
