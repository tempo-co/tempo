import {Transform} from 'class-transformer';
import {IsNotEmpty, IsString, Length, Matches, MaxLength} from 'class-validator';

export class BankConnectionAuthorizeDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	aspspName: string;

	@Transform(({value}) => (typeof value === 'string' ? value.toUpperCase() : value))
	@IsString()
	@Length(2, 2)
	@Matches(/^[A-Z]{2}$/)
	aspspCountry: string;
}
