import type {EmailVerifyRequest} from '@tempo/contracts';
import {IsEmail, IsNotEmpty, Length, Matches} from 'class-validator';

import {Account} from '@modules/account/account.entity';

import {NormalizeEmail} from './normalize-email';

export class EmailVerifyDto implements EmailVerifyRequest {
	@IsNotEmpty()
	@Matches(/^[0-9]{6}$/, {message: 'Verification code must be 6 digits.'})
	code: string;

	@NormalizeEmail()
	@IsNotEmpty()
	@IsEmail()
	@Length(1, 255)
	email: Account['email'];
}
