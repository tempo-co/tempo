import {HttpException, Injectable, ValidationPipe} from '@nestjs/common';
import {instanceToPlain} from 'class-transformer';

import {Account} from '@modules/account/account.entity';

import {ToolReadError} from '../../../../../mcp/src/errors';
import type {ToolReader} from '../../../../../mcp/src/tools';
import {BankTransactionBreakdownQueryDto} from '../api/dtos/bank-transaction-breakdown-query.dto';
import {BankTransactionCashFlowQueryDto} from '../api/dtos/bank-transaction-cash-flow-query.dto';
import {BankTransactionQueryDto, BankTransactionTotalsQueryDto} from '../api/dtos/bank-transaction-query.dto';
import {BankTransactionSummaryQueryDto} from '../api/dtos/bank-transaction-summary-query.dto';
import {MerchantGroupsQueryDto, MerchantRankingQueryDto} from '../api/dtos/merchant-query.dto';
import {RecurringSeriesQueryDto} from '../api/dtos/recurring-series.dto';
import {MerchantGroupIdPipe} from '../api/pipes/merchant-group-id.pipe';
import {BankingService} from '../banking.service';
import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {BankTransactionHistoryService} from './bank-transaction-history.service';
import {BankTransactionSummaryService} from './bank-transaction-summary.service';
import {BankTransactionService} from './bank-transaction.service';
import {MerchantSpendingService} from './merchant-spending.service';

@Injectable()
export class McpReaderService {
	private readonly validation = new ValidationPipe({whitelist: true, transform: true});
	private readonly merchantId = new MerchantGroupIdPipe();

	constructor(
		private readonly banking: BankingService,
		private readonly transactions: BankTransactionService,
		private readonly summaries: BankTransactionSummaryService,
		private readonly recurring: RecurringSeriesService,
		private readonly history: BankTransactionHistoryService,
		private readonly merchants: MerchantSpendingService,
	) {}

	/** Capture the authenticated owner once; caller input can only filter that owner's data. */
	forAccount(account: Account): ToolReader {
		const query = <T>(value: unknown, metatype: new () => T): Promise<T> =>
			this.validation.transform(value, {type: 'query', metatype});
		const read = async <T>(operation: () => Promise<T>): Promise<T> => {
			try {
				// These services explicitly map entities to the same @tempo/contracts shapes REST returns.
				// Apply the global REST ClassSerializerInterceptor's class-transformer boundary too; it keeps the shape.
				return instanceToPlain(await operation()) as T;
			} catch (error) {
				throw new ToolReadError(error instanceof HttpException ? error.getStatus() : 500);
			}
		};
		return {
			listAccounts: () => read(() => this.banking.findAll(account)),
			listRecurring: (input) =>
				read(async () => this.recurring.list(account, (await query(input, RecurringSeriesQueryDto)).asOf)),
			recurringSummary: (input) =>
				read(async () => this.recurring.summary(account, (await query(input, RecurringSeriesQueryDto)).asOf)),
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
			searchTransactions: ({filters, sort, page, pageSize}) =>
				read(async () =>
					this.transactions.findAll(
						account.id,
						await query(
							{filter: filters, sort, pagination: {pageIndex: page, pageSize}},
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
			spendingBreakdown: (input) =>
				read(async () =>
					this.history.getBreakdown(account, await query(input, BankTransactionBreakdownQueryDto)),
				),
			listMerchants: (input) =>
				read(async () => this.merchants.list(account, await query(input, MerchantGroupsQueryDto))),
			merchantRanking: (input) =>
				read(async () => this.merchants.getRanking(account, await query(input, MerchantRankingQueryDto))),
			getMerchant: (id) => read(() => this.merchants.get(account, this.merchantId.transform(id))),
			merchantPeriods: (id, input) =>
				read(async () =>
					this.merchants.getPeriods(
						account,
						this.merchantId.transform(id),
						await query(input, BankTransactionCashFlowQueryDto),
					),
				),
		};
	}
}
