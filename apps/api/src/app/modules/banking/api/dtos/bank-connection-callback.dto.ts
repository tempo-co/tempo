import {IsOptional, IsString, MaxLength} from 'class-validator';

export class BankConnectionCallbackDto {
	@IsOptional()
	@IsString()
	@MaxLength(256)
	state?: string;

	@IsOptional()
	@IsString()
	@MaxLength(4096)
	code?: string;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	error?: string;

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	error_description?: string;
}
