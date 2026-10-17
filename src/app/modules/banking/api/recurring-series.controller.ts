import {Body, Controller, Get, HttpCode, Param, Patch, Query} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';

import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {RecurringSeriesDecisionUpdateDto, RecurringSeriesQueryDto} from './dtos/recurring-series.dto';
import {SeriesKeyPipe} from './pipes/series-key.pipe';

@ApiTags('Recurring series')
@Controller('recurring-series')
export class RecurringSeriesController {
	constructor(private readonly recurringSeriesService: RecurringSeriesService) {}

	@Get()
	findAll(@CurrentAccount() account: Account, @Query() query: RecurringSeriesQueryDto) {
		return this.recurringSeriesService.list(account, query);
	}

	@Patch(':key/decision')
	@HttpCode(204)
	async updateDecision(
		@CurrentAccount() account: Account,
		@Param('key', SeriesKeyPipe) key: string,
		@Body() dto: RecurringSeriesDecisionUpdateDto,
	) {
		await this.recurringSeriesService.updateDecision(account.id, key, dto.decision);
	}
}
