import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {
	BankTransactionBulkCategoryPreview,
	BankTransactionBulkCategoryResult,
	BankTransactionBulkCategoryScope,
	BankTransactionCategory,
} from '@wisp/contracts';
import {EntityManager, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import type {BulkSelection} from '../api/dtos/bank-transaction-bulk-selection.dto';
import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import type {BulkCategoryFollowUps} from '../categorization/manual-category-follow-up';
import {ManualCategoryService} from '../categorization/manual-category.service';
import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {AccountHistoryWriterService} from './account-history-writer.service';
import {toCategoryImpactTransaction} from './bank-transaction.service';
import {BANK_CONNECTION_PROVIDERS} from './banking-sync.constants';
import {type ResolvedBulkSelection, findSelectedTransactions, resolveBulkSelection} from './bulk-selection';

/**
 * One category for several of the owner's rows at once: the preview of the other rows from their payees, and the write
 * that changes just the selected rows or all of them. The learned choices follow one correction's rules
 * (`ManualCategoryService`): every selected row becomes the owner's manual choice, and the other rows take the
 * follow-up their payee's choices allow.
 */
@Injectable()
export class BulkCategoryService {
	private readonly logger = new Logger(BulkCategoryService.name);

	constructor(
		@InjectRepository(BankTransaction)
		private readonly repository: Repository<BankTransaction>,
		private readonly manualCategoryService: ManualCategoryService,
		private readonly scheduler: CategorizationScheduler,
		private readonly accountHistoryWriter: AccountHistoryWriterService,
		private readonly recurringSeriesService: RecurringSeriesService,
	) {}

	/** Lists the other rows from the selected rows' payees that changing all of them would change; writes nothing. */
	async preview(
		accountId: Account['id'],
		selection: BulkSelection,
		category: BankTransactionCategory,
	): Promise<BankTransactionBulkCategoryPreview> {
		const resolved = await resolveBulkSelection(this.recurringSeriesService, accountId, selection);
		const selected = await findSelectedTransactions(this.repository.manager, accountId, resolved);
		const followUps = await this.manualCategoryService.planBulkCategory(accountId, selected, category);
		const {transactions, total} = await this.manualCategoryService.findBulkCategoryFollowUps(
			accountId,
			followUps,
			selected.map(({id}) => id),
		);
		return {
			transactions: transactions.map((row) => {
				const apply = followUps.applyMerchantKeys.includes(row.merchantKey ?? '');
				return {
					...toCategoryImpactTransaction(row),
					action: apply ? 'APPLY' : 'RECHECK',
					appliedCategory: apply ? category : null,
				};
			}),
			total,
			selected: selected.length,
		};
	}

	/**
	 * Gives the selected rows the category, and with `ALL` the rows the preview lists too, in one history write: a
	 * selection holding a row that is not the owner's, or a filter that matches none, is refused (404) and nothing is
	 * written. A filter is matched again inside the write.
	 */
	async update(
		accountId: Account['id'],
		selection: BulkSelection,
		category: BankTransactionCategory,
		scope: BankTransactionBulkCategoryScope,
	): Promise<BankTransactionBulkCategoryResult> {
		const resolved = await resolveBulkSelection(this.recurringSeriesService, accountId, selection);
		const selected = await findSelectedTransactions(this.repository.manager, accountId, resolved);
		const followUps = await this.manualCategoryService.planBulkCategory(accountId, selected, category);
		const followUpRows =
			scope === 'ALL'
				? (
						await this.manualCategoryService.findBulkCategoryFollowUps(
							accountId,
							followUps,
							selected.map(({id}) => id),
						)
					).transactions
				: [];
		const syncedConnectionIds = await findSyncedConnectionIds(this.repository.manager, accountId, [
			...selected.map(({bankAccountId}) => bankAccountId),
			...followUpRows.map(({bankAccountId}) => bankAccountId),
		]);

		const {updated, recheckIds} = await this.accountHistoryWriter.write(
			accountId,
			{syncedConnectionIds},
			async ({manager}) =>
				this.writeSelection(
					manager,
					accountId,
					resolved,
					followUps,
					followUpRows.map(({id}) => id),
				),
		);
		// The write is committed: a failed enqueue leaves the rechecked rows PENDING for the scheduler's sweep.
		try {
			await this.scheduler.enqueueForTransactions(recheckIds);
		} catch (error) {
			this.logger.warn(`Enqueueing rows a bulk category rechecks failed: ${safeErrorName(error)}`);
		}
		return {updated};
	}

	/** The write itself, on the selected rows as they are inside it. */
	private async writeSelection(
		manager: EntityManager,
		accountId: Account['id'],
		selection: ResolvedBulkSelection,
		followUps: BulkCategoryFollowUps,
		followUpIds: readonly string[],
	) {
		const selected = await findSelectedTransactions(manager, accountId, selection);
		return this.manualCategoryService.writeBulkCategory(manager, accountId, selected, followUps, followUpIds);
	}
}

/** The owner's bank-synced connections holding these accounts, whose sync leases the write takes. */
async function findSyncedConnectionIds(
	manager: EntityManager,
	accountId: Account['id'],
	bankAccountIds: readonly string[],
): Promise<string[]> {
	const rows: {id: string}[] = await manager.query(
		`SELECT DISTINCT connection."id" FROM "bank_accounts" bank_account
		INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
		WHERE bank_account."id" = ANY($1::uuid[]) AND connection."accountId" = $2 AND connection."provider" <> $3`,
		[[...new Set(bankAccountIds)], accountId, BANK_CONNECTION_PROVIDERS.FILE],
	);
	return rows.map(({id}) => id);
}
