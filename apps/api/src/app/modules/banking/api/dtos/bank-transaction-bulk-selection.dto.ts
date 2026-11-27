import {BadRequestException} from '@nestjs/common';
import {BANK_TRANSACTION_BULK_MAX_IDS, type BankTransactionBulkSelection} from '@tempo/contracts';
import {Type} from 'class-transformer';
import {ArrayMaxSize, ArrayMinSize, IsArray, IsObject, IsOptional, IsUUID, ValidateNested} from 'class-validator';

import {BankTransactionFilterQueryDto} from './bank-transaction-query.dto';

/** The rows a bulk action is for: the picked ids, or every row the Transactions list's filters match. */
export type BulkSelection = {transactionIds: readonly string[]} | {filter: BankTransactionFilterQueryDto};

/** The selection is `transactionIds` or `filter`, never both: `toBulkSelection` refuses anything else. */
export class BankTransactionBulkSelectionDto implements BankTransactionBulkSelection {
	/** The owner's picked rows; one that is not theirs refuses the whole request. */
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(BANK_TRANSACTION_BULK_MAX_IDS)
	@IsUUID('4', {each: true})
	transactionIds?: string[];

	/** Every one of the owner's rows the Transactions list's filters match; matching none refuses the request. */
	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => BankTransactionFilterQueryDto)
	filter?: BankTransactionFilterQueryDto;
}

/** The request's selection; refuses (400) a request that sends both ids and a filter, or neither. */
export function toBulkSelection(dto: BankTransactionBulkSelectionDto): BulkSelection {
	if (dto.transactionIds && !dto.filter) return {transactionIds: dto.transactionIds};
	if (dto.filter && !dto.transactionIds) return {filter: dto.filter};
	throw new BadRequestException(['Send either transactionIds or filter']);
}
