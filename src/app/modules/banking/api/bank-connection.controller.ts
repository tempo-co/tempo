import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';
import {Request, Response} from 'express';

import {ConfigurationService} from '@core/config/config.service';
import {createWebUrl} from '@core/config/web-url';
import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {Public} from '@modules/auth/decorators/public.decorator';
import {TokenReadable} from '@modules/auth/decorators/token-readable.decorator';
import {CsrfOriginGuard} from '@modules/auth/guards/csrf-origin.guard';

import {BankingService} from '../banking.service';
import {BankingSyncCooldownError} from '../errors/banking-sync-cooldown.error';
import {BankTransactionService} from '../services/bank-transaction.service';
import {BankingSyncService} from '../services/banking-sync.service';
import {BankConnectionAuthorizeDto} from './dtos/bank-connection-authorize.dto';
import {BankConnectionCallbackDto} from './dtos/bank-connection-callback.dto';
import {BankConnectionRemoveDto} from './dtos/bank-connection-remove.dto';
import {BankConnectionTransactionsQueryDto} from './dtos/bank-connection-transactions-query.dto';

@Controller('bank-connections')
export class BankConnectionController {
	constructor(
		private readonly bankingService: BankingService,
		private readonly bankTransactionService: BankTransactionService,
		private readonly bankingSyncService: BankingSyncService,
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

	@Post(':connectionId/refresh')
	@HttpCode(200)
	@UseGuards(CsrfOriginGuard)
	async refreshConnection(
		@Param('connectionId', new ParseUUIDPipe({version: '4'})) connectionId: string,
		@CurrentAccount() account: Account,
		@Req() request: Request,
		@Res({passthrough: true}) response: Response,
	) {
		const abortController = new AbortController();
		const abort = () => abortController.abort();
		const close = () => {
			if (!response.writableFinished) abort();
		};
		request.once('aborted', abort);
		response.once('close', close);
		if (request.aborted || response.destroyed) abort();
		try {
			const run = await this.bankingSyncService.synchronizeManually(
				account.id,
				connectionId,
				{
					ipAddress: request.ip ?? '',
					userAgent: request.get('User-Agent'),
				},
				abortController.signal,
			);
			// Synchronized moments ago: nothing was fetched, so there is no run to return.
			if (!run) response.status(204);
			return run;
		} catch (error) {
			if (error instanceof BankingSyncCooldownError) response.setHeader('Retry-After', error.retryAfterSeconds);
			throw error;
		} finally {
			request.off('aborted', abort);
			response.off('close', close);
		}
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
