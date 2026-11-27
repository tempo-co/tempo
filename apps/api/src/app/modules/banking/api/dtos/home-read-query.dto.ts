import type {HomeReadQuery} from '@tempo/contracts';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

export class HomeReadQueryDto implements HomeReadQuery {
	@IsCalendarDate()
	asOf: string;
}
