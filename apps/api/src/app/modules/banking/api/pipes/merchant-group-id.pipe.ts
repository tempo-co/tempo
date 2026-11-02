import {BadRequestException, Injectable, PipeTransform} from '@nestjs/common';
import {MERCHANT_GROUP_ID_PATTERN} from '@tempo/contracts';

import {MERCHANT_GROUP_ID_INVALID} from '../constants/banking-messages.constants';

const PATTERN = new RegExp(MERCHANT_GROUP_ID_PATTERN);

@Injectable()
export class MerchantGroupIdPipe implements PipeTransform<string, string> {
	transform(value: string): string {
		if (!PATTERN.test(value)) throw new BadRequestException(MERCHANT_GROUP_ID_INVALID);
		return value;
	}
}
