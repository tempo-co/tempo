import {getFormatter} from './money';

/** Round steps from zero that cover every value, so gridlines read as a ruler. Takes cents. */
export function axisTicks(minCents: number, maxCents: number) {
  const low = Math.min(minCents, 0) / 100;
  // An all-negative line tops out at zero instead of four empty positive steps.
  const high = maxCents > 0 || minCents >= 0 ? Math.max(maxCents / 100, 100) : 0;
  const below = low < 0 ? 1 : 0;
  const rough = ((high - low) * 1.06) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * magnitude >= rough)! * magnitude;
  const first = below ? Math.floor(low / step) : 0;
  const last = Math.max(Math.ceil((high * 1.02) / step), below ? 0 : first + 4);
  return Array.from({length: last - first + 1}, (_, index) => (first + index) * step);
}

/** "€4K" on the axis; a plain "4K" before the owner has a base currency. */
export function axisFormatter(currency: string | null) {
  return getFormatter(`axis:${currency ?? ''}`, {
    notation: 'compact',
    maximumFractionDigits: 1,
    ...(currency ? {style: 'currency', currency, currencyDisplay: 'narrowSymbol'} : {}),
  });
}
