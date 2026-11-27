const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Whether `text` contains the typed `query`, ignoring case, accents and the spaces around it. */
export function matchesSearch(text: string, query: string) {
  return fold(text).includes(fold(query.trim()));
}
