import {Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {Throttle, minutes} from '@nestjs/throttler';
import {Response} from 'express';

import {ConfigurationService} from '@core/config/config.service';
import {createWebUrl} from '@core/config/web-url';
import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {Public} from '@modules/auth/decorators/public.decorator';
import {TokenReadable} from '@modules/auth/decorators/token-readable.decorator';

import {BankingService} from '../banking.service';
import {BankTransactionService} from '../services/bank-transaction.service';
import {BankConnectionAuthorizeDto} from './dtos/bank-connection-authorize.dto';
import {BankConnectionCallbackDto} from './dtos/bank-connection-callback.dto';
import {BankConnectionRemoveDto} from './dtos/bank-connection-remove.dto';
import {BankConnectionTransactionsQueryDto} from './dtos/bank-connection-transactions-query.dto';

@ApiTags('Bank connections')
@Controller('bank-connections')
export class BankConnectionController {
	constructor(
		private readonly bankingService: BankingService,
		private readonly bankTransactionService: BankTransactionService,
		private readonly configurationService: ConfigurationService,
	) {}

	@Post('authorize')
	@HttpCode(201)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	async startAuthorization(@Body() dto: BankConnectionAuthorizeDto, @CurrentAccount() account: Account) {
		return this.bankingService.startAuthorization(account.id, dto);
	}

	@Get('aspsps')
	async getSupportedAspsps() {
		return this.bankingService.findSupportedAspsps();
	}

	@Get()
	@TokenReadable()
	async getConnections(@CurrentAccount() account: Account) {
		return this.bankingService.findAll(account);
	}

	@Delete(':connectionId')
	@HttpCode(204)
	async removeConnection(
		@Param('connectionId', new ParseUUIDPipe({version: '4'})) connectionId: string,
		@Body() dto: BankConnectionRemoveDto,
		@CurrentAccount() account: Account,
	) {
		await this.bankingService.removeConnection(account.id, connectionId, dto.confirmation);
	}

	@Public()
	@Get('callback')
	async handleCallback(@Query() query: BankConnectionCallbackDto, @Res() response: Response) {
		const result = await this.bankingService.handleCallback(query);

		const redirectUrl = createWebUrl('/bank-connections', this.configurationService.get('WEB_BASE_URL'), {result});
		return response.redirect(302, redirectUrl);
	}

	@Get(':connectionId/transactions')
	async getTransactions(
		@Param('connectionId', new ParseUUIDPipe({version: '4'})) connectionId: string,
		@Query() query: BankConnectionTransactionsQueryDto,
		@CurrentAccount() account: Account,
	) {
		return this.bankTransactionService.findAllByConnectionId(account.id, connectionId, query.limit);
	}
}
