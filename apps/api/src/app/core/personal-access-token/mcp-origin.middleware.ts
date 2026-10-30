import {Request, RequestHandler} from 'express';

import {isMcpRequest} from './mcp-request';

export function isMcpOriginAllowed(request: Request, webOrigin: string): boolean {
	return request.headers.origin === undefined || request.headers.origin === webOrigin;
}

/** Run before CORS and body parsing, including preflight and unsupported HTTP methods. */
export function mcpOriginMiddleware(webOrigin: string): RequestHandler {
	return (request, response, next) => {
		if (isMcpRequest(request) && !isMcpOriginAllowed(request, webOrigin)) {
			response.status(403).json({statusCode: 403, message: 'Forbidden'});
			return;
		}
		next();
	};
}
