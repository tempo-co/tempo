import {Body, Controller, Get, HttpCode, Param, Patch, Query} from '@nestjs/common';
import type {RecurringSeriesLists, RecurringSummary} from '@tempo/contracts';

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

@Controller('recurring-series')
export class RecurringSeriesController {
	constructor(private readonly recurringSeriesService: RecurringSeriesService) {}

	@Get()
	@TokenReadable()
	findAll(
		@CurrentAccount() account: Account,
		@Query() query: RecurringSeriesQueryDto,
	): Promise<RecurringSeriesLists> {
		return this.recurringSeriesService.list(account, query.asOf);
	}

	@Get('summary')
	@TokenReadable()
	summary(@CurrentAccount() account: Account, @Query() query: RecurringSeriesQueryDto): Promise<RecurringSummary> {
		return this.recurringSeriesService.summary(account, query.asOf);
	}

	@Patch(':key/hidden')
	@HttpCode(204)
	async updateHidden(
		@CurrentAccount() account: Account,
		@Param('key', SeriesKeyPipe) key: string,
		@Body() dto: RecurringSeriesHiddenUpdateDto,
	): Promise<void> {
		await this.recurringSeriesService.updateHidden(account.id, key, dto.hidden);
	}

	@Patch(':key/continuation')
	@HttpCode(204)
	async updateContinuation(
		@CurrentAccount() account: Account,
		@Param('key', SeriesKeyPipe) key: string,
		@Body() dto: RecurringContinuationUpdateDto,
	): Promise<void> {
		await this.recurringSeriesService.updateContinuation(account.id, key, dto.linked);
	}
}
