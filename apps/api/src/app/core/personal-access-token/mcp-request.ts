import type {Request} from 'express';
import parseUrl from 'parseurl';

/** Match Express's case-insensitive /mcp route and optional trailing slash before session middleware. */
export function isMcpRequest(request: Request): boolean {
	// Express's router parses paths with parseurl, which also accepts absolute-form HTTP request targets.
	return /^\/mcp\/?$/i.test(parseUrl.original(request)?.pathname ?? '');
}
