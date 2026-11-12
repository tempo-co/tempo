import {BadRequestException, Injectable, UnauthorizedException} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {plainToClass} from 'class-transformer';
import {validate} from 'class-validator';
import {randomBytes} from 'node:crypto';
import {Strategy} from 'passport-local';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';

import {INVALID_CREDENTIALS} from '../api/constants/api-messages.constants';
import {LogInDto} from '../api/dtos/login.dto';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
	/** Hash of a random secret with the same cost as real passwords, verified when the email is unknown. */
	private readonly dummyPasswordHash: Promise<string>;

	constructor(private readonly accountService: AccountService) {
		super({usernameField: 'email'});
		this.dummyPasswordHash = accountService.hashPassword(randomBytes(32).toString('base64url'));
	}

	async validate(email: Account['email'], password: Account['password']) {
		const credentials = plainToClass(LogInDto, {email, password});
		const errors = await validate(credentials);

		if (errors.length > 0) {
			const formattedErrors = errors.flatMap((err) => Object.values(err.constraints || {}));
			throw new BadRequestException(formattedErrors);
		}

		const account = await this.accountService.findByEmail(credentials.email);
		// An unknown email still costs one password check and gets the same answer as a wrong password,
		// so neither the response nor its timing tells them apart.
		const hash = account?.password ?? (await this.dummyPasswordHash);
		const isPasswordValid = await this.accountService.isPasswordValid(hash, credentials.password);
		if (!account || !isPasswordValid) {
			throw new UnauthorizedException(INVALID_CREDENTIALS);
		}
		return account;
	}
}
