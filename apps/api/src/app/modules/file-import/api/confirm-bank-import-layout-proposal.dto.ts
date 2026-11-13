import type {ConfirmBankImportLayoutProposalRequest} from '@tempo/contracts';
import {IsOptional, IsString, Length, Matches} from 'class-validator';

export class ConfirmBankImportLayoutProposalDto implements ConfirmBankImportLayoutProposalRequest {
	@IsString()
	@Length(1, 60)
	bankName: string;

	@IsOptional()
	@IsString()
	@Matches(/^[A-Z]{3}$/)
	currency?: string;
}
