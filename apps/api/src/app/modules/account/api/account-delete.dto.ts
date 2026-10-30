import type {AccountDeleteRequest} from '@tempo/contracts';
import {IsNotEmpty, IsString, Length} from 'class-validator';

import {Account} from '@modules/account/account.entity';

export class AccountDeleteDto implements AccountDeleteRequest {
	@IsNotEmpty()
	@IsString()
	@Length(8, 255)
	password: Account['password'];
}
