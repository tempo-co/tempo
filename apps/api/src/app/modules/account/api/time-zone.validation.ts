import {Transform} from 'class-transformer';
import {ValidateBy, ValidationOptions} from 'class-validator';

import {supportedTimeZone} from '@core/time/app-time-zone';

export const INVALID_TIME_ZONE = 'timeZone must be a supported IANA time zone';

/** Accepts a supported time zone and stores it in the API's spelling; anything else fails validation. */
export function IsSupportedTimeZone(options?: ValidationOptions): PropertyDecorator {
	const normalize = Transform(({value}) => supportedTimeZone(value) ?? value);
	const validate = ValidateBy(
		{
			name: 'isSupportedTimeZone',
			validator: {
				validate: (value) => typeof value === 'string' && supportedTimeZone(value) === value,
				defaultMessage: () => INVALID_TIME_ZONE,
			},
		},
		options,
	);
	return (target, propertyKey) => {
		normalize(target, propertyKey);
		validate(target, propertyKey);
	};
}
