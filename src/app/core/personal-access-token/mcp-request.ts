import type {Request} from 'express';
import {parse} from 'node:url';

/** Match Express's case-insensitive /mcp route and optional trailing slash before session middleware. */
export function isMcpRequest(request: Request): boolean {
	// Express's URL parser also accepts absolute-form HTTP request targets.
	return /^\/mcp\/?$/i.test(parse(request.originalUrl).pathname ?? '');
}
