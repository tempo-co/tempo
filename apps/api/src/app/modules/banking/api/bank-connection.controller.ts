import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	ParseUUIDPipe,
	Post,
	Put,
	Query,
	Req,
	Res,
	UseInterceptors,
} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';
import type {
	BankAccount,
	BankConnection,
	BankConnectionAspsp,
	BankConnectionAuthorizationResponse,
	BankConnectionTransactionsResponse,
	BankSyncRun,
} from '@tempo/contracts';
import {Request, Response} from 'express';

import {ConfigurationService} from '@core/config/config.service';
import {createWebUrl} from '@core/config/web-url';
import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {Public} from '@modules/auth/decorators/public.decorator';
import {TokenReadable} from '@modules/auth/decorators/token-readable.decorator';

import {BankingSyncCooldownError} from '../errors/banking-sync-cooldown.error';
import {AspspCatalogService} from '../services/aspsp-catalog.service';
import {BankAuthorizationService} from '../services/bank-authorization.service';
import {BankConnectionQueryService} from '../services/bank-connection-query.service';
import {BankConnectionRemovalService} from '../services/bank-connection-removal.service';
import {BankTransactionService} from '../services/bank-transaction.service';
import {BankingSyncService} from '../services/banking-sync.service';
import {FileAccountBalanceService} from '../services/file-account-balance.service';
import {BANKING_ACCOUNT_NOT_FOUND} from './constants/banking-messages.constants';
import {BankConnectionAuthorizeDto} from './dtos/bank-connection-authorize.dto';
import {BankConnectionCallbackDto} from './dtos/bank-connection-callback.dto';
import {BankConnectionRemoveDto} from './dtos/bank-connection-remove.dto';
import {BankConnectionTransactionsQueryDto} from './dtos/bank-connection-transactions-query.dto';
import {SetBankAccountBalanceDto} from './dtos/set-bank-account-balance.dto';
import {TotalsCurrencyInterceptor} from './totals-currency.interceptor';

@UseInterceptors(TotalsCurrencyInterceptor)
@Controller('bank-connections')
export class BankConnectionController {
	constructor(
		private readonly aspspCatalogService: AspspCatalogService,
		private readonly bankAuthorizationService: BankAuthorizationService,
		private readonly bankConnectionQueryService: BankConnectionQueryService,
		private readonly bankConnectionRemovalService: BankConnectionRemovalService,
		private readonly bankTransactionService: BankTransactionService,
		private readonly bankingSyncService: BankingSyncService,
		private readonly configurationService: ConfigurationService,
		private readonly fileAccountBalanceService: FileAccountBalanceService,
	) {}

	@Post('authorize')
	@HttpCode(201)
	@Throttle({default: {limit: 10, ttl: minutes(1)}})
	async startAuthorization(
		@Body() dto: BankConnectionAuthorizeDto,
		@CurrentAccount() account: Account,
	): Promise<BankConnectionAuthorizationResponse> {
		return this.bankAuthorizationService.startAuthorization(account.id, dto);
	}

	@Get('aspsps')
	async getSupportedAspsps(): Promise<BankConnectionAspsp[]> {
		return this.aspspCatalogService.findSupportedAspsps();
	}

	@Get()
	@TokenReadable()
	async getConnections(@CurrentAccount() account: Account): Promise<BankConnection[]> {
		return this.bankConnectionQueryService.findAll(account);
	}

	@Post(':connectionId/refresh')
	@HttpCode(200)
	async refreshConnection(
		@Param('connectionId', new ParseUUIDPipe({version: '4'})) connectionId: string,
		@CurrentAccount() account: Account,
		@Req() request: Request,
		@Res({passthrough: true}) response: Response,
	): Promise<BankSyncRun | null> {
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

	/** The balance of an imported-files account today, entered by its owner. */
	@Put(':connectionId/accounts/:accountId/balance')
	async setAccountBalance(
		@Param('connectionId', new ParseUUIDPipe({version: '4'})) connectionId: string,
		@Param('accountId', new ParseUUIDPipe({version: '4'})) accountId: string,
		@Body() dto: SetBankAccountBalanceDto,
		@CurrentAccount() account: Account,
	): Promise<BankAccount> {
		await this.fileAccountBalanceService.setStatedBalance(account, connectionId, accountId, dto.amount);
		const updated = await this.bankConnectionQueryService.findAccount(account, connectionId, accountId);
		// Only a removal committing right after the balance was stored gets here.
		if (!updated) throw new NotFoundException(BANKING_ACCOUNT_NOT_FOUND);
		return updated;
	}

	@Delete(':connectionId')
	@HttpCode(204)
	async removeConnection(
		@Param('connectionId', new ParseUUIDPipe({version: '4'})) connectionId: string,
		@Body() dto: BankConnectionRemoveDto,
		@CurrentAccount() account: Account,
	) {
		await this.bankConnectionRemovalService.removeConnection(account.id, connectionId, dto.confirmation);
	}

	@Public()
	@Get('callback')
	async handleCallback(@Query() query: BankConnectionCallbackDto, @Res() response: Response) {
		const result = await this.bankAuthorizationService.handleCallback(query);

		const redirectUrl = createWebUrl('/bank-connections', this.configurationService.get('WEB_BASE_URL'), {result});
		return response.redirect(302, redirectUrl);
	}

	@Get(':connectionId/transactions')
	async getTransactions(
		@Param('connectionId', new ParseUUIDPipe({version: '4'})) connectionId: string,
		@Query() query: BankConnectionTransactionsQueryDto,
		@CurrentAccount() account: Account,
	): Promise<BankConnectionTransactionsResponse> {
		return this.bankTransactionService.findAllByConnectionId(account.id, connectionId, query.limit);
	}
}
