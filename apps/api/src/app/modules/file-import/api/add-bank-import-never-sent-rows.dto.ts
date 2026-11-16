import {AddBankImportNeverSentRowsRequest, BANK_IMPORT_MAX_ROWS_PER_ADD} from '@tempo/contracts';
import {ArrayMaxSize, ArrayMinSize, IsArray, IsUUID} from 'class-validator';

export class AddBankImportNeverSentRowsDto implements AddBankImportNeverSentRowsRequest {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(BANK_IMPORT_MAX_ROWS_PER_ADD)
	@IsUUID('4', {each: true})
	rowIds: string[];
}
