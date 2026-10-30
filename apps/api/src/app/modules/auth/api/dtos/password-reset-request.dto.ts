import type {PasswordResetRequest} from '@tempo/contracts';
import {IsEmail, IsNotEmpty, Length} from 'class-validator';

import {Account} from '@modules/account/account.entity';

import {NormalizeEmail} from './normalize-email';

export class PasswordResetRequestDto implements PasswordResetRequest {
	@NormalizeEmail()
	@IsNotEmpty()
	@IsEmail()
	@Length(1, 255)
	email: Account['email'];
}
