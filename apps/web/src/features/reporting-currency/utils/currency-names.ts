const names = new Intl.DisplayNames(['en'], {type: 'currency', fallback: 'code'});

/** The English name of a currency code, or the code itself when there is none. */
export function currencyName(code: string) {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** How a currency reads in a picker: `EUR — Euro`. */
export function currencyLabel(code: string) {
  const name = currencyName(code);
  return name === code ? code : `${code} — ${name}`;
}

/** Whether a currency matches what was typed, by code or name. */
export function matchesCurrency(code: string, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || currencyLabel(code).toLocaleLowerCase().includes(needle);
}

/** What a total leaves out for want of an amount in the reporting currency. */
export function missingAmountsLabel(count: number, currency: string) {
  return count === 1
    ? `1 transaction isn’t included in ${currency} totals`
    : `${count.toLocaleString()} transactions aren’t included in ${currency} totals`;
}
