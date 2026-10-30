import {IsOptional, IsString} from 'class-validator';

export class BankConnectionRemoveDto {
	@IsOptional()
	@IsString()
	confirmation?: string;
}
