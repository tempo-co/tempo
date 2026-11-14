import {Body, Controller, Get, Put} from '@nestjs/common';
import type {ReportingCurrency} from '@tempo/contracts';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';

import {ReportingCurrencyService} from '../services/reporting-currency.service';
import {ReportingCurrencyUpdateDto} from './dtos/reporting-currency-update.dto';

@Controller('reporting-currency')
export class ReportingCurrencyController {
	constructor(private readonly reportingCurrencyService: ReportingCurrencyService) {}

	@Get()
	get(@CurrentAccount() account: Account): Promise<ReportingCurrency> {
		return this.reportingCurrencyService.get(account.id);
	}

	@Put()
	choose(@CurrentAccount() account: Account, @Body() body: ReportingCurrencyUpdateDto): Promise<ReportingCurrency> {
		return this.reportingCurrencyService.choose(account.id, body.currency);
	}
}
