let regionNames: Intl.DisplayNames | undefined;

/** A country's name in the browser's language, from its ISO 3166-1 alpha-2 code; the code when it has none. */
export function countryName(code: string) {
  try {
    regionNames ??= new Intl.DisplayNames(undefined, {type: 'region'});
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The first of the browser's language regions that `isKnown` accepts, as an upper-case country code. */
export function browserRegion(isKnown: (code: string) => boolean) {
  return navigator.languages
    .map((tag) => {
      try {
        return new Intl.Locale(tag).maximize().region;
      } catch {
        return undefined;
      }
    })
    .find((region): region is string => region !== undefined && isKnown(region));
}
