import {BadRequestException, Injectable, PipeTransform} from '@nestjs/common';

import {BANKING_RECURRING_SERIES_KEY_INVALID} from '../constants/banking-messages.constants';

export const SERIES_KEY_PATTERN = /^[0-9a-f]{32}$/;

@Injectable()
export class SeriesKeyPipe implements PipeTransform<string, string> {
	transform(value: string): string {
		if (!SERIES_KEY_PATTERN.test(value)) throw new BadRequestException(BANKING_RECURRING_SERIES_KEY_INVALID);
		return value;
	}
}
