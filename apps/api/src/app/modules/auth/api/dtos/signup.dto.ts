import {IsEmail, IsNotEmpty, IsString, Length} from 'class-validator';

import {Account} from '@modules/account/account.entity';

import {NormalizeEmail} from './normalize-email';

export class SignUpDto {
	@IsNotEmpty()
	@IsString()
	@Length(1, 255)
	name: Account['name'];

	@NormalizeEmail()
	@IsNotEmpty()
	@IsEmail()
	@Length(1, 255)
	email: Account['email'];

	@IsNotEmpty()
	@IsString()
	@Length(8, 255)
	password: Account['password'];
}
