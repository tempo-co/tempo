/** Exact decimal amounts for the parsers: integer units of 10^-8, so sums never round. */
export const AMOUNT_SCALE = 8;

export type Decimal = {units: bigint; scale: number};

/**
 * A plain decimal with an optional sign and the given fraction separator (`-12,5`, `850,`, `4.50`); null for any
 * other form, including thousands separators and exponents.
 */
export function parseDecimal(text: string, separator: '.' | ','): Decimal | null {
	const [, sign, whole, fraction = ''] =
		(separator === ',' ? /^([+-]?)(\d{1,15})(?:,(\d{0,8}))?$/ : /^([+-]?)(\d{1,15})(?:\.(\d{1,8}))?$/).exec(text) ??
		[];
	if (whole === undefined) return null;
	const units = BigInt(whole) * 10n ** BigInt(AMOUNT_SCALE) + BigInt(fraction.padEnd(AMOUNT_SCALE, '0'));
	return {units: sign === '-' ? -units : units, scale: fraction.length};
}

/** Units as a decimal string with `scale` fraction digits (at most `AMOUNT_SCALE`). */
export function formatUnits(units: bigint, scale: number): string {
	const negative = units < 0n;
	const absolute = (negative ? -units : units).toString().padStart(AMOUNT_SCALE + 1, '0');
	const whole = absolute.slice(0, -AMOUNT_SCALE);
	const fraction = absolute.slice(-AMOUNT_SCALE, -AMOUNT_SCALE + scale || undefined);
	return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}

/** The scale amounts are written in: at least the two decimals of a currency, more when the file has more. */
export function amountScale(...decimals: Decimal[]): number {
	return Math.max(2, ...decimals.map(({scale}) => scale));
}
