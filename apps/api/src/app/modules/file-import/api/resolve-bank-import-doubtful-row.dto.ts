import {
	BANK_IMPORT_DOUBTFUL_DECISIONS,
	BankImportDoubtfulDecision,
	ResolveBankImportDoubtfulRowRequest,
} from '@tempo/contracts';
import {IsIn, IsUUID, ValidateIf} from 'class-validator';

export class ResolveBankImportDoubtfulRowDto implements ResolveBankImportDoubtfulRowRequest {
	@IsIn(BANK_IMPORT_DOUBTFUL_DECISIONS)
	decision: BankImportDoubtfulDecision;

	@ValidateIf((dto: ResolveBankImportDoubtfulRowDto) => dto.decision === 'duplicate')
	@IsUUID('4')
	transactionId?: string;
}
