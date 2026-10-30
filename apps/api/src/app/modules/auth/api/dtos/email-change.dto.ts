import {IsEmail, IsNotEmpty, Length} from 'class-validator';

import {Account} from '@modules/account/account.entity';

import {NormalizeEmail} from './normalize-email';

export class EmailChangeRequestDto {
	@NormalizeEmail()
	@IsNotEmpty()
	@IsEmail()
	@Length(1, 255)
	newEmail: Account['email'];
}
