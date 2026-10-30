import type {AccountUpdateRequest} from '@tempo/contracts';
import {IsString, Length} from 'class-validator';

import {Account} from '../account.entity';

export class AccountUpdateDto implements AccountUpdateRequest {
	@IsString()
	@Length(1, 255)
	name: Account['name'];
}
