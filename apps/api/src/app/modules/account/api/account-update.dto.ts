import {IsString, Length} from 'class-validator';

import {Account} from '../account.entity';

export class AccountUpdateDto {
	@IsString()
	@Length(1, 255)
	name: Account['name'];
}
