import type {Request} from 'express';

/** Bearer credentials are authoritative, including malformed or revoked credentials. */
export function isBearerRequest(request: Request): boolean {
	return /^\s*Bearer(?:\s|$)/i.test(request.headers.authorization ?? '');
}
