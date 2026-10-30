import {TransformFnParams} from 'class-transformer';

const DECIMAL_INTEGER_PATTERN = /^\d+$/;

export function transformStrictDecimalInteger({value}: TransformFnParams) {
	if (value === undefined) return undefined;
	if (typeof value === 'number') return value;
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return Number.NaN;
	if (!DECIMAL_INTEGER_PATTERN.test(value)) return Number.NaN;

	return Number(value);
}
