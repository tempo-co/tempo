import type {BankConnectionRemoveRequest} from '@tempo/contracts';
import {IsBoolean, IsOptional, IsString} from 'class-validator';

export class BankConnectionRemoveDto implements BankConnectionRemoveRequest {
	@IsOptional()
	@IsString()
	confirmation?: string;

	@IsOptional()
	@IsBoolean()
	keepAccounts?: boolean;
}
