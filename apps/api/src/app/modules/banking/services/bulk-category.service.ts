import {Injectable, NotFoundException} from '@nestjs/common';
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
import {BankTransaction} from '../bank-transaction.entity';
import {CategorizationScheduler} from '../categorization/categorization-scheduler.service';
import type {BulkCategoryFollowUps} from '../categorization/manual-category-follow-up';
import {ManualCategoryService} from '../categorization/manual-category.service';
import {AccountHistoryWriterService} from './account-history-writer.service';
import {toCategoryImpactTransaction} from './bank-transaction.service';
import {BANK_CONNECTION_PROVIDERS} from './banking-sync.constants';

/**
 * One category for several of the owner's rows at once: the preview of the other rows from their payees, and the write
 * that changes just the selected rows or all of them. The learned choices follow one correction's rules
 * (`ManualCategoryService`): every selected row becomes the owner's manual choice, and the other rows take the
 * follow-up their payee's choices allow.
 */
@Injectable()
export class BulkCategoryService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly repository: Repository<BankTransaction>,
		private readonly manualCategoryService: ManualCategoryService,
		private readonly scheduler: CategorizationScheduler,
		private readonly accountHistoryWriter: AccountHistoryWriterService,
	) {}

	/** Lists the other rows from the selected rows' payees that changing all of them would change; writes nothing. */
	async preview(
		accountId: Account['id'],
		transactionIds: readonly string[],
		category: BankTransactionCategory,
	): Promise<BankTransactionBulkCategoryPreview> {
		const selected = await findOwnedTransactions(this.repository.manager, accountId, transactionIds);
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
		};
	}

	/**
	 * Gives the selected rows the category, and with `ALL` the rows the preview lists too, in one history write: a
	 * selection holding a row that is not the owner's is refused (404) and nothing is written.
	 */
	async update(
		accountId: Account['id'],
		transactionIds: readonly string[],
		category: BankTransactionCategory,
		scope: BankTransactionBulkCategoryScope,
	): Promise<BankTransactionBulkCategoryResult> {
		const selected = await findOwnedTransactions(this.repository.manager, accountId, transactionIds);
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
					transactionIds,
					followUps,
					followUpRows.map(({id}) => id),
				),
		);
		await this.scheduler.enqueueForTransactions(recheckIds);
		return {updated};
	}

	/** The write itself, on the selected rows as they are inside it. */
	private async writeSelection(
		manager: EntityManager,
		accountId: Account['id'],
		transactionIds: readonly string[],
		followUps: BulkCategoryFollowUps,
		followUpIds: readonly string[],
	) {
		const selected = await findOwnedTransactions(manager, accountId, transactionIds);
		return this.manualCategoryService.writeBulkCategory(manager, accountId, selected, followUps, followUpIds);
	}
}

/** The owner's rows with these ids; refuses (404) when any id is not one of them. */
async function findOwnedTransactions(
	manager: EntityManager,
	accountId: Account['id'],
	transactionIds: readonly string[],
): Promise<BankTransaction[]> {
	const ids = [...new Set(transactionIds)];
	const transactions = await manager
		.getRepository(BankTransaction)
		.createQueryBuilder('transaction')
		// The bank's name is part of the categorization input the manual choice is stored for.
		.innerJoinAndSelect('transaction.bankAccount', 'bankAccount')
		.innerJoinAndSelect('bankAccount.bankConnection', 'connection')
		.where('connection.accountId = :accountId', {accountId})
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
