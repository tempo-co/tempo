import type {BankConnectionRemoveRequest} from '@tempo/contracts';
import {IsOptional, IsString} from 'class-validator';

export class BankConnectionRemoveDto implements BankConnectionRemoveRequest {
	@IsOptional()
	@IsString()
	confirmation?: string;
}
