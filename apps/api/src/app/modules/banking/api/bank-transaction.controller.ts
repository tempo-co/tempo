import {Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {TokenReadable} from '@modules/auth/decorators/token-readable.decorator';

import {BankTransactionSummaryService} from '../services/bank-transaction-summary.service';
import {BankTransactionService} from '../services/bank-transaction.service';
import {BankTransactionCashFlowQueryDto} from './dtos/bank-transaction-cash-flow-query.dto';
import {BankTransactionCategoryImpactQueryDto} from './dtos/bank-transaction-category-impact.dto';
import {BankTransactionCategoryUpdateDto} from './dtos/bank-transaction-category-update.dto';
import {BankTransactionOwnTransferUpdateDto} from './dtos/bank-transaction-own-transfer-update.dto';
import {BankTransactionQueryDto, BankTransactionTotalsQueryDto} from './dtos/bank-transaction-query.dto';
import {BankTransactionSummaryQueryDto} from './dtos/bank-transaction-summary-query.dto';

/**
 * Browsing months or paging through results sends one request per view, and every month or page
 * shares one per-route allowance, so these reads need more than the global default.
 */
const BROWSING_THROTTLE = {default: {limit: 300, ttl: minutes(1)}};

@Controller('bank-transactions')
export class BankTransactionController {
	constructor(
		private readonly bankTransactionService: BankTransactionService,
		private readonly bankTransactionSummaryService: BankTransactionSummaryService,
	) {}

	@Get()
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	findAll(@CurrentAccount() account: Account, @Query() query: BankTransactionQueryDto) {
		return this.bankTransactionService.findAll(account.id, query);
	}

	// Declared before `:id` so these paths are not parsed as transaction ids.
	@Get('totals')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getTotals(@CurrentAccount() account: Account, @Query() query: BankTransactionTotalsQueryDto) {
		return this.bankTransactionSummaryService.getTotals(account, query);
	}

	@Get('summary')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getSummary(@CurrentAccount() account: Account, @Query() query: BankTransactionSummaryQueryDto) {
		return this.bankTransactionSummaryService.getSummary(account, query);
	}

	@Get('cash-flow')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getCashFlow(@CurrentAccount() account: Account, @Query() query: BankTransactionCashFlowQueryDto) {
		return this.bankTransactionSummaryService.getCashFlow(account, query);
	}

	@Get('balance-trend')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getBalanceTrend(@CurrentAccount() account: Account, @Query() query: BankTransactionCashFlowQueryDto) {
		return this.bankTransactionSummaryService.getBalanceTrend(account, query);
	}

	@Get('review-counts')
	@TokenReadable()
	getReviewCounts(@CurrentAccount() account: Account) {
		return this.bankTransactionSummaryService.getReviewCounts(account.id);
	}

	@Get(':id')
	@TokenReadable()
	findOne(@CurrentAccount() account: Account, @Param('id', new ParseUUIDPipe({version: '4'})) id: string) {
		return this.bankTransactionService.findById(account.id, id);
	}

	/** Lists the owner's other rows a category correction would change, without saving anything. */
	@Get(':id/category-impact')
	getCategoryImpact(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Query() query: BankTransactionCategoryImpactQueryDto,
	) {
		return this.bankTransactionService.getCategoryImpact(account.id, id, query.category);
	}

	@Patch(':id/category')
	updateCategory(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Body() dto: BankTransactionCategoryUpdateDto,
	) {
		return this.bankTransactionService.updateCategory(account.id, id, dto.category, dto.applyToTransactionIds);
	}

	@Patch(':id/own-transfer')
	updateOwnTransfer(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Body() dto: BankTransactionOwnTransferUpdateDto,
	) {
		return this.bankTransactionService.updateOwnTransferOverride(account.id, id, dto.override);
	}
}
