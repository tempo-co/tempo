import type {RecurringContinuationUpdate, RecurringSeriesHiddenUpdate, RecurringSeriesQuery} from '@tempo/contracts';
import {IsBoolean} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

export class RecurringSeriesQueryDto implements RecurringSeriesQuery {
	@IsCalendarDate()
	asOf: string;
}

export class RecurringSeriesHiddenUpdateDto implements RecurringSeriesHiddenUpdate {
	@IsBoolean()
	hidden: boolean;
}

export class RecurringContinuationUpdateDto implements RecurringContinuationUpdate {
	@IsBoolean()
	linked: boolean;
}
