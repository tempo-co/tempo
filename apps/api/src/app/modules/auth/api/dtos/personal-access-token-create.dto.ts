import {Transform} from 'class-transformer';
import {IsIn, IsString, Length, ValidateIf} from 'class-validator';

export const PERSONAL_ACCESS_TOKEN_LIFETIMES = [30, 90, 365] as const;

export class PersonalAccessTokenCreateDto {
	@Transform(({value}: {value: unknown}) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@Length(1, 100)
	name: string;

	/** Days until the token expires, or null for a token that never expires. Omitted means 90. */
	@ValidateIf((_dto, value) => value !== null)
	@IsIn(PERSONAL_ACCESS_TOKEN_LIFETIMES)
	expiresInDays: number | null = 90;
}
