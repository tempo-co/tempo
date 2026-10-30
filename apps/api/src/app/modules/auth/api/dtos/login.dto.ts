import {IsEmail, IsNotEmpty, IsString, Length, MaxLength, MinLength} from 'class-validator';

import {Account} from '@modules/account/account.entity';

import {NormalizeEmail} from './normalize-email';

export class LogInDto {
	@NormalizeEmail()
	@IsNotEmpty()
	@IsEmail()
	@Length(1, 255)
	email: Account['email'];

	@IsNotEmpty()
	@IsString()
	@MinLength(8)
	@MaxLength(255)
	password: Account['password'];
}
