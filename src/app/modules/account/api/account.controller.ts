import {Body, Controller, Delete, Get, HttpCode, Patch} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';

import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {SkipEmailVerification} from '@modules/auth/decorators/skip-email-verification.decorator';

import {AccountDeletionService} from '../account-deletion.service';
import {Account} from '../account.entity';
import {AccountService} from '../account.service';
import {AccountDeleteDto} from './account-delete.dto';
import {AccountUpdateDto} from './account-update.dto';

@Controller('accounts')
export class AccountController {
	constructor(
		private readonly accountService: AccountService,
		private readonly accountDeletionService: AccountDeletionService,
	) {}

	@Get('me')
	@SkipEmailVerification()
	findOne(@CurrentAccount() account: Account) {
		return account;
	}

	@Patch('me')
	update(@Body() updates: AccountUpdateDto, @CurrentAccount() account: Account) {
		return this.accountService.update(account.id, updates);
	}

	@Delete('me')
	@HttpCode(200)
	@Throttle({default: {limit: 3, ttl: minutes(1)}})
	deleteMe(@Body() dto: AccountDeleteDto, @CurrentAccount() account: Account) {
		return this.accountDeletionService.deleteAccount(account.id, dto.password);
	}
}
