import type {PasswordChangeRequest} from '@tempo/contracts';
import {IsNotEmpty, IsString, Length} from 'class-validator';

import {Account} from '@modules/account/account.entity';

export class PasswordChangeDto implements PasswordChangeRequest {
	@IsNotEmpty()
	@IsString()
	@Length(8, 255)
	currentPassword: Account['password'];

	@IsNotEmpty()
	@IsString()
	@Length(8, 255)
	newPassword: Account['password'];
}
