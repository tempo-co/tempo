import {Body, Controller, Delete, Get, HttpCode, Patch} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';
import type {Account as AccountResponse, MessageResponse} from '@tempo/contracts';

import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {SkipEmailVerification} from '@modules/auth/decorators/skip-email-verification.decorator';

import {AccountDeletionService} from '../account-deletion.service';
import {Account} from '../account.entity';
import {AccountService} from '../account.service';
import {AccountDeleteDto} from './account-delete.dto';
import {toAccountResponse} from './account-response';
import {AccountUpdateDto} from './account-update.dto';

@Controller('accounts')
export class AccountController {
	constructor(
		private readonly accountService: AccountService,
		private readonly accountDeletionService: AccountDeletionService,
	) {}

	@Get('me')
	@SkipEmailVerification()
	findOne(@CurrentAccount() account: Account): AccountResponse {
		return toAccountResponse(account);
	}

	@Patch('me')
	async update(@Body() updates: AccountUpdateDto, @CurrentAccount() account: Account): Promise<AccountResponse> {
		return toAccountResponse(await this.accountService.update(account.id, updates));
	}

	@Delete('me')
	@HttpCode(200)
	@Throttle({default: {limit: 3, ttl: minutes(1)}})
	deleteMe(@Body() dto: AccountDeleteDto, @CurrentAccount() account: Account): Promise<MessageResponse> {
		return this.accountDeletionService.deleteAccount(account.id, dto.password);
	}
}
