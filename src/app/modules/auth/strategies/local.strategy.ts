import {BadRequestException, Injectable, UnauthorizedException} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {plainToClass} from 'class-transformer';
import {validate} from 'class-validator';
import {Strategy} from 'passport-local';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';

import {INVALID_CREDENTIALS} from '../api/constants/api-messages.constants';
import {LogInDto} from '../api/dtos/login.dto';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
	constructor(private readonly accountService: AccountService) {
		super({usernameField: 'email'});
	}

	async validate(email: Account['email'], password: Account['password']) {
		const credentials = plainToClass(LogInDto, {email, password});
		const errors = await validate(credentials);

		if (errors.length > 0) {
			const formattedErrors = errors.flatMap((err) => Object.values(err.constraints || {}));
			throw new BadRequestException(formattedErrors);
		}

		const account = await this.accountService.findByEmail(credentials.email);
		// The same answer for an unknown email and a wrong password, so the response body does not tell them apart.
		if (!account || !(await this.accountService.isPasswordValid(account.password, credentials.password))) {
			throw new UnauthorizedException(INVALID_CREDENTIALS);
		}
		return account;
	}
}
