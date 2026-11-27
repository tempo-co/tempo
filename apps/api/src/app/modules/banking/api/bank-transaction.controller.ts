import {
	Body,
	Controller,
	Get,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	Res,
	UseInterceptors,
} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import type {
	BankBalanceTrend,
	BankTransaction,
	BankTransactionBreakdown,
	BankTransactionBulkCategoryPreview,
	BankTransactionBulkCategoryResult,
	BankTransactionBulkLeftOutOfTotalsResult,
	BankTransactionCashFlow,
	BankTransactionCategoryImpact,
	BankTransactionDayTotals,
	BankTransactionRecurring,
	BankTransactionReviewCounts,
	BankTransactionSummary,
	BankTransactionTotals,
	BankTransactionsResponse,
	SpendingPace,
} from '@tempo/contracts';
import {Response} from 'express';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {TokenReadable} from '@modules/auth/decorators/token-readable.decorator';

import {BankTransactionHistoryService} from '../services/bank-transaction-history.service';
import {BankTransactionSummaryService} from '../services/bank-transaction-summary.service';
import {BankTransactionService} from '../services/bank-transaction.service';
import {BulkCategoryService} from '../services/bulk-category.service';
import {BROWSING_THROTTLE} from './constants/throttle.constants';
import {BankTransactionBreakdownQueryDto} from './dtos/bank-transaction-breakdown-query.dto';
import {
	BankTransactionBulkCategoryPreviewDto,
	BankTransactionBulkCategoryUpdateDto,
} from './dtos/bank-transaction-bulk-category.dto';
import {toBulkSelection} from './dtos/bank-transaction-bulk-selection.dto';
import {BankBalanceTrendQueryDto, BankTransactionCashFlowQueryDto} from './dtos/bank-transaction-cash-flow-query.dto';
import {BankTransactionCategoryImpactQueryDto} from './dtos/bank-transaction-category-impact.dto';
import {BankTransactionCategoryUpdateDto} from './dtos/bank-transaction-category-update.dto';
import {
	BankTransactionBulkLeftOutOfTotalsUpdateDto,
	BankTransactionLeftOutOfTotalsUpdateDto,
} from './dtos/bank-transaction-left-out-of-totals.dto';
import {BankTransactionOwnTransferUpdateDto} from './dtos/bank-transaction-own-transfer-update.dto';
import {BankTransactionQueryDto, BankTransactionTotalsQueryDto} from './dtos/bank-transaction-query.dto';
import {BankTransactionSummaryQueryDto} from './dtos/bank-transaction-summary-query.dto';
import {HomeReadQueryDto} from './dtos/home-read-query.dto';
import {RecurringSeriesQueryDto} from './dtos/recurring-series.dto';
import {TotalsCurrencyInterceptor} from './totals-currency.interceptor';

@UseInterceptors(TotalsCurrencyInterceptor)
@Controller('bank-transactions')
export class BankTransactionController {
	constructor(
		private readonly bankTransactionService: BankTransactionService,
		private readonly bankTransactionSummaryService: BankTransactionSummaryService,
		private readonly bankTransactionHistoryService: BankTransactionHistoryService,
		private readonly bulkCategoryService: BulkCategoryService,
	) {}

	@Get()
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	findAll(
		@CurrentAccount() account: Account,
		@Query() query: BankTransactionQueryDto,
	): Promise<BankTransactionsResponse> {
		return this.bankTransactionService.findAll(account.id, query);
	}

	// Declared before `:id` so these paths are not parsed as transaction ids.
	@Get('totals')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getTotals(
		@CurrentAccount() account: Account,
		@Query() query: BankTransactionTotalsQueryDto,
	): Promise<BankTransactionTotals> {
		return this.bankTransactionSummaryService.getTotals(account, query);
	}

	@Get('day-totals')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getDayTotals(
		@CurrentAccount() account: Account,
		@Query() query: BankTransactionTotalsQueryDto,
	): Promise<BankTransactionDayTotals> {
		return this.bankTransactionSummaryService.getDayTotals(account, query);
	}

	@Get('summary')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getSummary(
		@CurrentAccount() account: Account,
		@Query() query: BankTransactionSummaryQueryDto,
	): Promise<BankTransactionSummary> {
		return this.bankTransactionSummaryService.getSummary(account, query);
	}

	@Get('spending-pace')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getSpendingPace(@CurrentAccount() account: Account, @Query() query: HomeReadQueryDto): Promise<SpendingPace> {
		return this.bankTransactionSummaryService.getSpendingPace(account, query);
	}

	@Get('cash-flow')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getCashFlow(
		@CurrentAccount() account: Account,
		@Query() query: BankTransactionCashFlowQueryDto,
	): Promise<BankTransactionCashFlow> {
		return this.bankTransactionSummaryService.getCashFlow(account, query);
	}

	@Get('balance-trend')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getBalanceTrend(
		@CurrentAccount() account: Account,
		@Query() query: BankBalanceTrendQueryDto,
	): Promise<BankBalanceTrend> {
		return this.bankTransactionSummaryService.getBalanceTrend(account, query);
	}

	@Get('breakdown')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getBreakdown(
		@CurrentAccount() account: Account,
		@Query() query: BankTransactionBreakdownQueryDto,
	): Promise<BankTransactionBreakdown> {
		return this.bankTransactionHistoryService.getBreakdown(account, query);
	}

	@Get('review-counts')
	@TokenReadable()
	getReviewCounts(@CurrentAccount() account: Account): Promise<BankTransactionReviewCounts> {
		return this.bankTransactionSummaryService.getReviewCounts(account.id);
	}

	@Get(':id')
	@TokenReadable()
	findOne(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
	): Promise<BankTransaction> {
		return this.bankTransactionService.findById(account.id, id);
	}

	@Get(':id/recurring')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	async getRecurring(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Query() query: RecurringSeriesQueryDto,
		@Res() response: Response,
	): Promise<BankTransactionRecurring | null> {
		const recurring = await this.bankTransactionService.getRecurring(account.id, id, query.asOf);
		// Nest's default null response is empty; this read's wire contract is JSON null.
		response.json(recurring);
		return recurring;
	}

	/** Lists the other rows from the selected rows' payees that a bulk category could change too, without saving. */
	@Post('bulk-category/preview')
	@HttpCode(200)
	previewBulkCategory(
		@CurrentAccount() account: Account,
		@Body() dto: BankTransactionBulkCategoryPreviewDto,
	): Promise<BankTransactionBulkCategoryPreview> {
		return this.bulkCategoryService.preview(account.id, toBulkSelection(dto), dto.category);
	}

	@Patch('bulk-category')
	updateBulkCategory(
		@CurrentAccount() account: Account,
		@Body() dto: BankTransactionBulkCategoryUpdateDto,
	): Promise<BankTransactionBulkCategoryResult> {
		return this.bulkCategoryService.update(account.id, toBulkSelection(dto), dto.category, dto.scope);
	}

	@Patch('bulk-left-out-of-totals')
	updateBulkLeftOutOfTotals(
		@CurrentAccount() account: Account,
		@Body() dto: BankTransactionBulkLeftOutOfTotalsUpdateDto,
	): Promise<BankTransactionBulkLeftOutOfTotalsResult> {
		return this.bankTransactionService.updateBulkLeftOutOfTotals(
			account.id,
			toBulkSelection(dto),
			dto.leftOutOfTotals,
		);
	}

	/** Lists the owner's other rows a category correction would change, without saving anything. */
	@Get(':id/category-impact')
	getCategoryImpact(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Query() query: BankTransactionCategoryImpactQueryDto,
	): Promise<BankTransactionCategoryImpact> {
		return this.bankTransactionService.getCategoryImpact(account.id, id, query.category);
	}

	@Patch(':id/category')
	updateCategory(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Body() dto: BankTransactionCategoryUpdateDto,
	): Promise<BankTransaction> {
		return this.bankTransactionService.updateCategory(account.id, id, dto.category, dto.applyToTransactionIds);
	}

	@Patch(':id/left-out-of-totals')
	updateLeftOutOfTotals(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Body() dto: BankTransactionLeftOutOfTotalsUpdateDto,
	): Promise<BankTransaction> {
		return this.bankTransactionService.updateLeftOutOfTotals(account.id, id, dto.leftOutOfTotals);
	}

	@Patch(':id/own-transfer')
	updateOwnTransfer(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Body() dto: BankTransactionOwnTransferUpdateDto,
	): Promise<BankTransaction> {
		return this.bankTransactionService.updateOwnTransferOverride(account.id, id, dto.override);
	}
}
