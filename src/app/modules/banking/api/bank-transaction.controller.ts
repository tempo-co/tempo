import {Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {Throttle, minutes} from '@nestjs/throttler';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';

import {BankTransactionSummaryService} from '../services/bank-transaction-summary.service';
import {BankTransactionService} from '../services/bank-transaction.service';
import {BankTransactionCashFlowQueryDto} from './dtos/bank-transaction-cash-flow-query.dto';
import {BankTransactionCategoryUpdateDto} from './dtos/bank-transaction-category-update.dto';
import {BankTransactionOwnTransferUpdateDto} from './dtos/bank-transaction-own-transfer-update.dto';
import {BankTransactionQueryDto} from './dtos/bank-transaction-query.dto';
import {BankTransactionSummaryQueryDto} from './dtos/bank-transaction-summary-query.dto';

/**
 * Browsing months or paging through results sends one request per view, and every month or page
 * shares one per-route allowance, so these reads need more than the global default.
 */
const BROWSING_THROTTLE = {default: {limit: 300, ttl: minutes(1)}};

@ApiTags('Bank transactions')
@Controller('bank-transactions')
export class BankTransactionController {
	constructor(
		private readonly bankTransactionService: BankTransactionService,
		private readonly bankTransactionSummaryService: BankTransactionSummaryService,
	) {}

	@Get()
	@Throttle(BROWSING_THROTTLE)
	findAll(@CurrentAccount() account: Account, @Query() query: BankTransactionQueryDto) {
		return this.bankTransactionService.findAll(account.id, query);
	}

	// Declared before `:id` so these paths are not parsed as transaction ids.
	@Get('summary')
	@Throttle(BROWSING_THROTTLE)
	getSummary(@CurrentAccount() account: Account, @Query() query: BankTransactionSummaryQueryDto) {
		return this.bankTransactionSummaryService.getSummary(account, query);
	}

	@Get('cash-flow')
	@Throttle(BROWSING_THROTTLE)
	getCashFlow(@CurrentAccount() account: Account, @Query() query: BankTransactionCashFlowQueryDto) {
		return this.bankTransactionSummaryService.getCashFlow(account, query);
	}

	@Get('review-counts')
	getReviewCounts(@CurrentAccount() account: Account) {
		return this.bankTransactionSummaryService.getReviewCounts(account.id);
	}

	@Get(':id')
	findOne(@CurrentAccount() account: Account, @Param('id', new ParseUUIDPipe({version: '4'})) id: string) {
		return this.bankTransactionService.findById(account.id, id);
	}

	@Patch(':id/category')
	updateCategory(
		@CurrentAccount() account: Account,
		@Param('id', new ParseUUIDPipe({version: '4'})) id: string,
		@Body() dto: BankTransactionCategoryUpdateDto,
	) {
		return this.bankTransactionService.updateCategory(account.id, id, dto.category);
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
