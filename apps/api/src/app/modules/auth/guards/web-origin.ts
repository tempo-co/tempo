import {Request} from 'express';

/**
 * Whether the request carries the web app's exact Origin. Browsers send Origin on every non-GET
 * fetch and form post, so a missing, opaque (`null`) or other origin is a request the app did not make.
 */
export function isWebOriginRequest(request: Request, webOrigin: string): boolean {
	const origin = request.headers.origin;
	if (typeof origin !== 'string' || origin === 'null') return false;
	try {
		const requestOrigin = new URL(origin).origin;
		return requestOrigin === origin && requestOrigin === webOrigin;
	} catch {
		return false;
	}
}
