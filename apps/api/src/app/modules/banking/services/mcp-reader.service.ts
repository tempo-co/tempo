import {HttpException, Injectable, Logger, ValidationPipe} from '@nestjs/common';
import {instanceToPlain} from 'class-transformer';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankTransactionBreakdownQueryDto} from '../api/dtos/bank-transaction-breakdown-query.dto';
import {BankTransactionCashFlowQueryDto} from '../api/dtos/bank-transaction-cash-flow-query.dto';
import {BankTransactionQueryDto, BankTransactionTotalsQueryDto} from '../api/dtos/bank-transaction-query.dto';
import {BankTransactionSummaryQueryDto} from '../api/dtos/bank-transaction-summary-query.dto';
import {MerchantGroupsQueryDto, MerchantRankingQueryDto} from '../api/dtos/merchant-query.dto';
import {RecurringSeriesQueryDto} from '../api/dtos/recurring-series.dto';
import {MerchantGroupIdPipe} from '../api/pipes/merchant-group-id.pipe';
import {safeErrorStack} from '../bank-sync-failure';
import {ToolReadError} from '../mcp/errors';
import type {ToolReader} from '../mcp/tools';
import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {settleTotalsCurrency} from '../reporting-currency';
import {BankConnectionQueryService} from './bank-connection-query.service';
import {BankTransactionHistoryService} from './bank-transaction-history.service';
import {BankTransactionSummaryService} from './bank-transaction-summary.service';
import {BankTransactionService} from './bank-transaction.service';
import {MerchantSpendingService} from './merchant-spending.service';

@Injectable()
export class McpReaderService {
	private readonly logger = new Logger(McpReaderService.name);
	private readonly validation = new ValidationPipe({whitelist: true, transform: true});
	private readonly merchantId = new MerchantGroupIdPipe();

	constructor(
		private readonly connections: BankConnectionQueryService,
		private readonly transactions: BankTransactionService,
		private readonly summaries: BankTransactionSummaryService,
		private readonly recurring: RecurringSeriesService,
		private readonly history: BankTransactionHistoryService,
		private readonly merchants: MerchantSpendingService,
		private readonly dataSource: DataSource,
	) {}

	/** Capture the authenticated owner once; caller input can only filter that owner's data. */
	forAccount(account: Account): ToolReader {
		const query = <T>(value: unknown, metatype: new () => T): Promise<T> =>
			this.validation.transform(value, {type: 'query', metatype});
		const read = async <T>(operation: () => Promise<T>): Promise<T> => {
			try {
				// These services explicitly map entities to the same @tempo/contracts shapes REST returns.
				// Apply the global REST ClassSerializerInterceptor's class-transformer boundary too; it keeps the shape.
				// Like REST's TotalsCurrencyInterceptor: no currency name for amounts read across a currency change.
				return (await settleTotalsCurrency(
					this.dataSource.manager,
					account,
					instanceToPlain(await operation()),
				)) as T;
			} catch (error) {
				if (error instanceof HttpException) throw new ToolReadError(error.getStatus());
				// Like REST's exception filter, log unexpected failures; name and stack frames only, never the message.
				this.logger.error(`MCP read failed unexpectedly: ${safeErrorStack(error)}`);
				throw new ToolReadError(500);
			}
		};
		return {
			listAccounts: () => read(() => this.connections.findAll(account)),
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
