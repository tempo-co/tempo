import {IsNotEmpty, IsString, Length} from 'class-validator';

import {Account} from '@modules/account/account.entity';

export class AccountDeleteDto {
	@IsNotEmpty()
	@IsString()
	@Length(8, 255)
	password: Account['password'];
}
