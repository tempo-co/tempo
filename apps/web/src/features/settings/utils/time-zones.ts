/** This browser's IANA time zone, which signup sends; undefined when the browser does not say. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export type TimeZoneOption = {
  /** The IANA name the API stores. */
  value: string;
  /** The name for people: `America/New York`. */
  label: string;
  /** The zone's offset now, such as `GMT+2`. */
  offset: string;
};

/** A time zone's name for people: the IANA name with spaces for underscores. */
export function formatTimeZone(timeZone: string): string {
  return timeZone.replace(/_/g, ' ');
}

function offsetNow(timeZone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    return parts.find(({type}) => type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * The time zones this browser knows, plus UTC and the account's current one (another browser may spell it
 * differently), sorted by name.
 */
export function timeZoneOptions(current: string, now = new Date()): TimeZoneOption[] {
  // Not in this project's TypeScript lib yet; every supported browser has it.
  const {supportedValuesOf} = Intl as {supportedValuesOf?: (key: 'timeZone') => string[]};
  const names = new Set<string>(supportedValuesOf ? supportedValuesOf('timeZone') : []);
  names.add('UTC');
  names.add(current);
  return [...names]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({value, label: formatTimeZone(value), offset: offsetNow(value, now)}));
}

/** Whether a time zone matches what the owner typed: every word appears in its name or offset. */
export function matchesTimeZone(option: TimeZoneOption, query: string): boolean {
  const haystack = `${option.label} ${option.value} ${option.offset}`.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
