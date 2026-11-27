import {Injectable, Logger, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {
	BankTransactionBulkCategoryPreview,
	BankTransactionBulkCategoryResult,
	BankTransactionBulkCategoryScope,
	BankTransactionCategory,
} from '@tempo/contracts';
import {EntityManager, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BANKING_TRANSACTION_NOT_FOUND} from '../api/constants/banking-messages.constants';
import type {BulkCategorySelection} from '../api/dtos/bank-transaction-bulk-category.dto';
import type {BankTransactionFilterQueryDto} from '../api/dtos/bank-transaction-query.dto';
import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import type {BulkCategoryFollowUps} from '../categorization/manual-category-follow-up';
import {ManualCategoryService} from '../categorization/manual-category.service';
import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {AccountHistoryWriterService} from './account-history-writer.service';
import {applyBankTransactionFilters} from './bank-transaction-filters';
import {toCategoryImpactTransaction} from './bank-transaction.service';
import {BANK_CONNECTION_PROVIDERS} from './banking-sync.constants';

/** A selection as the write finds it: ids, or the filter with the recurring series' payments it names. */
type ResolvedSelection =
	| {transactionIds: readonly string[]}
	| {filter: BankTransactionFilterQueryDto; recurringIds: readonly string[] | undefined};

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
		selection: BulkCategorySelection,
		category: BankTransactionCategory,
	): Promise<BankTransactionBulkCategoryPreview> {
		const resolved = await this.resolve(accountId, selection);
		const selected = await findSelected(this.repository.manager, accountId, resolved);
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
		selection: BulkCategorySelection,
		category: BankTransactionCategory,
		scope: BankTransactionBulkCategoryScope,
	): Promise<BankTransactionBulkCategoryResult> {
		const resolved = await this.resolve(accountId, selection);
		const selected = await findSelected(this.repository.manager, accountId, resolved);
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
		selection: ResolvedSelection,
		followUps: BulkCategoryFollowUps,
		followUpIds: readonly string[],
	) {
		const selected = await findSelected(manager, accountId, selection);
		return this.manualCategoryService.writeBulkCategory(manager, accountId, selected, followUps, followUpIds);
	}

	/** A filter naming a recurring series selects that series' payments, as the list does. */
	private async resolve(accountId: Account['id'], selection: BulkCategorySelection): Promise<ResolvedSelection> {
		if ('transactionIds' in selection) return selection;
		const seriesKey = selection.filter.recurringSeriesKey;
		const recurringIds = seriesKey
			? await this.recurringSeriesService.findTransactionIds(accountId, seriesKey)
			: undefined;
		return {filter: selection.filter, recurringIds};
	}
}

/** The owner's selected rows; refuses (404) an id that is not theirs, or a filter that matches none of their rows. */
async function findSelected(
	manager: EntityManager,
	accountId: Account['id'],
	selection: ResolvedSelection,
): Promise<BankTransaction[]> {
	if ('transactionIds' in selection) return findOwnedTransactions(manager, accountId, selection.transactionIds);
	// A series with no payments matches nothing; an empty id list would read as no series filter.
	if (selection.recurringIds?.length === 0) throw new NotFoundException(BANKING_TRANSACTION_NOT_FOUND);
	const query = ownedTransactionsQuery(manager, accountId);
	applyBankTransactionFilters(query, selection.filter, selection.recurringIds);
	const transactions = await query.getMany();
	if (transactions.length === 0) throw new NotFoundException(BANKING_TRANSACTION_NOT_FOUND);
	return transactions;
}

/** The owner's rows with their account and connection, aliased as the list's filters expect. */
function ownedTransactionsQuery(manager: EntityManager, accountId: Account['id']) {
	return (
		manager
			.getRepository(BankTransaction)
			.createQueryBuilder('transaction')
			// The bank's name is part of the categorization input the manual choice is stored for.
			.innerJoinAndSelect('transaction.bankAccount', 'bankAccount')
			.innerJoinAndSelect('bankAccount.bankConnection', 'connection')
			.where('connection.accountId = :accountId', {accountId})
	);
}

/** The owner's rows with these ids; refuses (404) when any id is not one of them. */
async function findOwnedTransactions(
	manager: EntityManager,
	accountId: Account['id'],
	transactionIds: readonly string[],
): Promise<BankTransaction[]> {
	const ids = [...new Set(transactionIds)];
	const transactions = await ownedTransactionsQuery(manager, accountId)
		.andWhere('transaction.id IN (:...ids)', {ids})
		.getMany();
	if (transactions.length !== ids.length) throw new NotFoundException(BANKING_TRANSACTION_NOT_FOUND);
	return transactions;
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
