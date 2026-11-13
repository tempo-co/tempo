import type {AccountUpdateRequest} from '@tempo/contracts';
import {IsString, Length, ValidateIf} from 'class-validator';

import {Account} from '../account.entity';
import {IsSupportedTimeZone} from './time-zone.validation';

/** Each field is optional; a field that is sent (even as null) must be valid. */
export class AccountUpdateDto implements AccountUpdateRequest {
	@ValidateIf((_dto, value) => value !== undefined)
	@IsString()
	@Length(1, 255)
	name?: Account['name'];

	@ValidateIf((_dto, value) => value !== undefined)
	@IsSupportedTimeZone()
	timeZone?: Account['timeZone'];
}
