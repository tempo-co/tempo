import {BANK_REQUEST_FILE_TYPES, BANK_REQUEST_MAX_NAME_LENGTH, bankNameSpelling} from '@tempo/contracts';
import type {BankRequestFileType, CreateBankRequest} from '@tempo/contracts';
import {Transform} from 'class-transformer';
import {ArrayMinSize, ArrayUnique, IsArray, IsISO31661Alpha2, IsIn, IsString, Length, Matches} from 'class-validator';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g;

export class CreateBankRequestDto implements CreateBankRequest {
	/** Kept as plain text: control characters become spaces, and spacing is made single. */
	@Transform(({value}: {value: unknown}) =>
		typeof value === 'string' ? bankNameSpelling(value.replace(CONTROL_CHARACTERS, ' ')) : value,
	)
	@IsString()
	@Length(1, BANK_REQUEST_MAX_NAME_LENGTH)
	bankName: string;

	@IsString()
	@Matches(/^[A-Z]{2}$/)
	@IsISO31661Alpha2()
	country: string;

	@IsArray()
	@ArrayMinSize(1)
	@ArrayUnique()
	@IsIn(BANK_REQUEST_FILE_TYPES, {each: true})
	fileTypes: BankRequestFileType[];
}
