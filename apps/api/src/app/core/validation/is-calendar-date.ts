import {applyDecorators} from '@nestjs/common';
import {IsDateString, Matches} from 'class-validator';

/** A strict ISO calendar date with no time component. Optionality belongs to the caller. */
export function IsCalendarDate() {
	// Match the registration order of stacked @IsDateString / @Matches decorators.
	return applyDecorators(Matches(/^\d{4}-\d{2}-\d{2}$/), IsDateString({strict: true}));
}
