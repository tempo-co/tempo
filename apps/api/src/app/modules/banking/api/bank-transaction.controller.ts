import {Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Res} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import type {
	BankBalanceTrend,
	BankTransaction,
	BankTransactionCashFlow,
	BankTransactionCategoryImpact,
	BankTransactionRecurring,
	BankTransactionReviewCounts,
	BankTransactionSummary,
	BankTransactionTotals,
	BankTransactionsResponse,
} from '@tempo/contracts';
import {Response} from 'express';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {TokenReadable} from '@modules/auth/decorators/token-readable.decorator';

import {BankTransactionSummaryService} from '../services/bank-transaction-summary.service';
import {BankTransactionService} from '../services/bank-transaction.service';
import {BROWSING_THROTTLE} from './constants/throttle.constants';
import {BankTransactionCashFlowQueryDto} from './dtos/bank-transaction-cash-flow-query.dto';
import {BankTransactionCategoryImpactQueryDto} from './dtos/bank-transaction-category-impact.dto';
import {BankTransactionCategoryUpdateDto} from './dtos/bank-transaction-category-update.dto';
import {BankTransactionOwnTransferUpdateDto} from './dtos/bank-transaction-own-transfer-update.dto';
import {BankTransactionQueryDto, BankTransactionTotalsQueryDto} from './dtos/bank-transaction-query.dto';
import {BankTransactionSummaryQueryDto} from './dtos/bank-transaction-summary-query.dto';
import {RecurringSeriesQueryDto} from './dtos/recurring-series.dto';

@Controller('bank-transactions')
export class BankTransactionController {
	constructor(
		private readonly bankTransactionService: BankTransactionService,
		private readonly bankTransactionSummaryService: BankTransactionSummaryService,
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

	@Get('summary')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getSummary(
		@CurrentAccount() account: Account,
		@Query() query: BankTransactionSummaryQueryDto,
	): Promise<BankTransactionSummary> {
		return this.bankTransactionSummaryService.getSummary(account, query);
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
		@Query() query: BankTransactionCashFlowQueryDto,
	): Promise<BankBalanceTrend> {
		return this.bankTransactionSummaryService.getBalanceTrend(account, query);
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

	@Patch(':id/own-transfer')
	updateOwnTransfer(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Body() dto: BankTransactionOwnTransferUpdateDto,
	): Promise<BankTransaction> {
		return this.bankTransactionService.updateOwnTransferOverride(account.id, id, dto.override);
	}
}
