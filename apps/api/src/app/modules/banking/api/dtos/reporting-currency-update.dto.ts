import type {ReportingCurrencyUpdateRequest} from '@tempo/contracts';
import {IsString, Matches} from 'class-validator';

export class ReportingCurrencyUpdateDto implements ReportingCurrencyUpdateRequest {
	@IsString()
	@Matches(/^[A-Z]{3}$/, {message: 'currency must be a three-letter currency code'})
	currency: string;
}
