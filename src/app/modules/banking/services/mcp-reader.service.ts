import {HttpException, Injectable, ValidationPipe} from '@nestjs/common';
import {instanceToPlain} from 'class-transformer';

import {Account} from '@modules/account/account.entity';

import {ToolReadError} from '../../../../../mcp/src/errors';
import type {ToolReader} from '../../../../../mcp/src/tools';
import {BankTransactionCashFlowQueryDto} from '../api/dtos/bank-transaction-cash-flow-query.dto';
import {BankTransactionQueryDto, BankTransactionTotalsQueryDto} from '../api/dtos/bank-transaction-query.dto';
import {BankTransactionSummaryQueryDto} from '../api/dtos/bank-transaction-summary-query.dto';
import {BankingService} from '../banking.service';
import {BankTransactionSummaryService} from './bank-transaction-summary.service';
import {BankTransactionService} from './bank-transaction.service';

@Injectable()
export class McpReaderService {
	private readonly validation = new ValidationPipe({whitelist: true, transform: true});

	constructor(
		private readonly banking: BankingService,
		private readonly transactions: BankTransactionService,
		private readonly summaries: BankTransactionSummaryService,
	) {}

	/** Capture the authenticated owner once; caller input can only filter that owner's data. */
	forAccount(account: Account): ToolReader {
		const query = <T>(value: unknown, metatype: new () => T): Promise<T> =>
			this.validation.transform(value, {type: 'query', metatype});
		const read = async (operation: () => Promise<unknown>) => {
			try {
				// These services explicitly map entities to the same public DTOs used by REST.
				// Apply the global REST ClassSerializerInterceptor's class-transformer boundary too.
				return instanceToPlain(await operation());
			} catch (error) {
				throw new ToolReadError(error instanceof HttpException ? error.getStatus() : 500);
			}
		};
		return {
			listAccounts: () => read(() => this.banking.findAll(account)),
			monthSummary: (input) =>
				read(async () =>
					this.summaries.getSummary(account, await query(input, BankTransactionSummaryQueryDto)),
				),
			cashFlow: (input) =>
				read(async () =>
					this.summaries.getCashFlow(account, await query(input, BankTransactionCashFlowQueryDto)),
				),
			balanceTrend: (input) =>
				read(async () =>
					this.summaries.getBalanceTrend(account, await query(input, BankTransactionCashFlowQueryDto)),
				),
			searchTransactions: ({filters, page, pageSize}) =>
				read(async () =>
					this.transactions.findAll(
						account.id,
						await query(
							{filter: filters, pagination: {pageIndex: page, pageSize}},
							BankTransactionQueryDto,
						),
					),
				),
			transactionTotals: ({filters}) =>
				read(async () =>
					this.summaries.getTotals(account, await query({filter: filters}, BankTransactionTotalsQueryDto)),
				),
			getTransaction: (id) => read(() => this.transactions.findById(account.id, id)),
			reviewCounts: () => read(() => this.summaries.getReviewCounts(account.id)),
		};
	}
}
