export function parseRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;

  if (/^\d+$/.test(value)) return Number(value);

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return undefined;

  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}

export function formatRetryAfter(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'Please try again later.';

  const roundedSeconds = Math.max(1, Math.ceil(seconds));
  if (roundedSeconds < 60) {
    return `Please try again in about ${roundedSeconds} second${roundedSeconds === 1 ? '' : 's'}.`;
  }

  const roundedMinutes = Math.ceil(roundedSeconds / 60);
  if (roundedMinutes < 60) {
    return `Please try again in about ${roundedMinutes} minute${roundedMinutes === 1 ? '' : 's'}.`;
  }

  const roundedHours = Math.ceil(roundedMinutes / 60);
  return `Please try again in about ${roundedHours} hour${roundedHours === 1 ? '' : 's'}.`;
}
