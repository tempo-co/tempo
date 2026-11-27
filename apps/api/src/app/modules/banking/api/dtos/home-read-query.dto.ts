import type {HomeReadQuery} from '@wisp/contracts';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

export class HomeReadQueryDto implements HomeReadQuery {
	@IsCalendarDate()
	asOf: string;
}
