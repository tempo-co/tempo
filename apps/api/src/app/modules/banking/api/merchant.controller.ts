import {Controller, Get, Param, Query} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import type {MerchantGroup, MerchantGroupPeriods, MerchantGroupsResponse, MerchantRanking} from '@tempo/contracts';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {TokenReadable} from '@modules/auth/decorators/token-readable.decorator';

import {MerchantSpendingService} from '../services/merchant-spending.service';
import {BROWSING_THROTTLE} from './constants/throttle.constants';
import {BankTransactionCashFlowQueryDto} from './dtos/bank-transaction-cash-flow-query.dto';
import {MerchantGroupsQueryDto, MerchantRankingQueryDto} from './dtos/merchant-query.dto';
import {MerchantGroupIdPipe} from './pipes/merchant-group-id.pipe';

@Controller('merchants')
export class MerchantController {
	constructor(private readonly merchantSpendingService: MerchantSpendingService) {}

	@Get()
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	list(@CurrentAccount() account: Account, @Query() query: MerchantGroupsQueryDto): Promise<MerchantGroupsResponse> {
		return this.merchantSpendingService.list(account, query);
	}

	// Declared before `:id` so the path is not parsed as a merchant id.
	@Get('ranking')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getRanking(@CurrentAccount() account: Account, @Query() query: MerchantRankingQueryDto): Promise<MerchantRanking> {
		return this.merchantSpendingService.getRanking(account, query);
	}

	@Get(':id')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	get(@CurrentAccount() account: Account, @Param('id', MerchantGroupIdPipe) id: string): Promise<MerchantGroup> {
		return this.merchantSpendingService.get(account, id);
	}

	@Get(':id/periods')
	@TokenReadable()
	@Throttle(BROWSING_THROTTLE)
	getPeriods(
		@CurrentAccount() account: Account,
		@Param('id', MerchantGroupIdPipe) id: string,
		@Query() query: BankTransactionCashFlowQueryDto,
	): Promise<MerchantGroupPeriods> {
		return this.merchantSpendingService.getPeriods(account, id, query);
	}
}
