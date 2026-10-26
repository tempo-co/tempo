import {Body, Controller, Get, HttpCode, Param, Patch, Query} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {TokenReadable} from '@modules/auth/decorators/token-readable.decorator';

import {RecurringSeriesService} from '../recurring/recurring-series.service';
import {
	RecurringContinuationUpdateDto,
	RecurringSeriesHiddenUpdateDto,
	RecurringSeriesQueryDto,
} from './dtos/recurring-series.dto';
import {SeriesKeyPipe} from './pipes/series-key.pipe';

@ApiTags('Recurring series')
@Controller('recurring-series')
export class RecurringSeriesController {
	constructor(private readonly recurringSeriesService: RecurringSeriesService) {}

	@Get()
	@TokenReadable()
	findAll(@CurrentAccount() account: Account, @Query() query: RecurringSeriesQueryDto) {
		return this.recurringSeriesService.list(account, query.asOf);
	}

	@Get('summary')
	@TokenReadable()
	summary(@CurrentAccount() account: Account, @Query() query: RecurringSeriesQueryDto) {
		return this.recurringSeriesService.summary(account, query.asOf);
	}

	@Patch(':key/hidden')
	@HttpCode(204)
	async updateHidden(
		@CurrentAccount() account: Account,
		@Param('key', SeriesKeyPipe) key: string,
		@Body() dto: RecurringSeriesHiddenUpdateDto,
	) {
		await this.recurringSeriesService.updateHidden(account.id, key, dto.hidden);
	}

	@Patch(':key/continuation')
	@HttpCode(204)
	async updateContinuation(
		@CurrentAccount() account: Account,
		@Param('key', SeriesKeyPipe) key: string,
		@Body() dto: RecurringContinuationUpdateDto,
	) {
		await this.recurringSeriesService.updateContinuation(account.id, key, dto.linked);
	}
}
