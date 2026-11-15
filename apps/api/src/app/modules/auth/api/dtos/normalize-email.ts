import {Transform} from 'class-transformer';

/** Trims and lowercases an email before validation, so lookups and uniqueness ignore casing. */
export function NormalizeEmail() {
	return Transform(({value}: {value: unknown}) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
}
