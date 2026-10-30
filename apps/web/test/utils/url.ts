/** Builds `path?key=value…` from any params object, keeping empty values so tests can cover them. */
export function withSearchParams(path: string, params: object) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) searchParams.set(key, String(value));
  return `${path}?${searchParams.toString()}`;
}
