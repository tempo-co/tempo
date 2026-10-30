import type {PasswordResetVerifyRequest} from '@tempo/contracts';
import {IsNotEmpty, IsString, IsUUID, Length} from 'class-validator';

import {Account} from '@modules/account/account.entity';

export class PasswordResetVerifyDto implements PasswordResetVerifyRequest {
	@IsNotEmpty()
	@IsString()
	@IsUUID('4')
	token: string;

	@IsNotEmpty()
	@IsString()
	@Length(8, 255)
	newPassword: Account['password'];
}
