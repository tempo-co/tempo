import {NotFoundException} from '@nestjs/common';
import {EntityManager} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BANKING_TRANSACTION_NOT_FOUND} from '../api/constants/banking-messages.constants';
import type {BulkSelection} from '../api/dtos/bank-transaction-bulk-selection.dto';
import type {BankTransactionFilterQueryDto} from '../api/dtos/bank-transaction-query.dto';
import {BankTransaction} from '../bank-transaction.entity';
import type {RecurringSeriesService} from '../recurring/recurring-series.service';
import {applyBankTransactionFilters} from './bank-transaction-filters';

/** A selection as a write finds it: ids, or the filter with the recurring series' payments it names. */
export type ResolvedBulkSelection =
	| {transactionIds: readonly string[]}
	| {filter: BankTransactionFilterQueryDto; recurringIds: readonly string[] | undefined};

/** A filter naming a recurring series selects that series' payments, as the list does. */
export async function resolveBulkSelection(
	recurringSeriesService: Pick<RecurringSeriesService, 'findTransactionIds'>,
	accountId: Account['id'],
	selection: BulkSelection,
): Promise<ResolvedBulkSelection> {
	if ('transactionIds' in selection) return selection;
	const seriesKey = selection.filter.recurringSeriesKey;
	const recurringIds = seriesKey ? await recurringSeriesService.findTransactionIds(accountId, seriesKey) : undefined;
	return {filter: selection.filter, recurringIds};
}

/**
 * The owner's selected rows with their account and connection; refuses (404) an id that is not theirs, or a filter
 * that matches none of their rows.
 */
export async function findSelectedTransactions(
	manager: EntityManager,
	accountId: Account['id'],
	selection: ResolvedBulkSelection,
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
			// The bank's name is part of the categorization input a manual choice is stored for.
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
