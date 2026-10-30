import {Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards} from '@nestjs/common';

import {PersonalAccessTokenService} from '@core/personal-access-token/personal-access-token.service';
import {Account} from '@modules/account/account.entity';

import {CurrentAccount} from '../decorators/current-user.decorator';
import {CsrfOriginGuard} from '../guards/csrf-origin.guard';
import {PersonalAccessTokenCreateDto} from './dtos/personal-access-token-create.dto';

@Controller('personal-access-tokens')
export class PersonalAccessTokenController {
	constructor(private readonly tokens: PersonalAccessTokenService) {}

	@Get()
	list(@CurrentAccount() account: Account) {
		return this.tokens.list(account.id);
	}

	@Post()
	@UseGuards(CsrfOriginGuard)
	create(@CurrentAccount() account: Account, @Body() dto: PersonalAccessTokenCreateDto) {
		return this.tokens.create(account.id, dto.name, dto.expiresInDays);
	}

	@Delete(':id')
	@HttpCode(204)
	@UseGuards(CsrfOriginGuard)
	async revoke(@CurrentAccount() account: Account, @Param('id', new ParseUUIDPipe({version: '4'})) id: string) {
		await this.tokens.revoke(account.id, id);
	}
}
