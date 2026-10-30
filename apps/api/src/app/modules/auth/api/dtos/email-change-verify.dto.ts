import {IsEmail, IsNotEmpty, IsString, IsUUID, Length} from 'class-validator';

import {Account} from '@modules/account/account.entity';

import {NormalizeEmail} from './normalize-email';

export class EmailChangeVerifyDto {
	@IsNotEmpty()
	@IsString()
	@IsUUID('4')
	token: string;

	@NormalizeEmail()
	@IsNotEmpty()
	@IsEmail()
	@Length(1, 255)
	email: Account['email'];
}
