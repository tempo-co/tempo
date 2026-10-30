import {
	PERSONAL_ACCESS_TOKEN_LIFETIMES,
	type PersonalAccessTokenCreateRequest,
	type PersonalAccessTokenLifetime,
} from '@tempo/contracts';
import {Transform} from 'class-transformer';
import {IsIn, IsString, Length, ValidateIf} from 'class-validator';

export class PersonalAccessTokenCreateDto implements PersonalAccessTokenCreateRequest {
	@Transform(({value}: {value: unknown}) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@Length(1, 100)
	name: string;

	/** Days until the token expires, or null for a token that never expires. Omitted means 90. */
	@ValidateIf((_dto, value) => value !== null)
	@IsIn(PERSONAL_ACCESS_TOKEN_LIFETIMES)
	expiresInDays: PersonalAccessTokenLifetime | null = 90;
}
