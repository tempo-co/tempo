/**
 * Whether a server error came from the API itself, whose error body names its status and a message, so its import route is there.
 * A proxy in front of it answers with a page instead (a 502 while the API restarts), which says nothing about the
 * route.
 */
export function isApiServerError(status: number, body: unknown): boolean {
  return (
    status >= 500 &&
    typeof body === 'object' &&
    body !== null &&
    'statusCode' in body &&
    body.statusCode === status &&
    'message' in body &&
    typeof body.message === 'string'
  );
}
