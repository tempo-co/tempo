import {ArgumentsHost, Catch, ExceptionFilter, HttpException} from '@nestjs/common';
import {BaseExceptionFilter, HttpAdapterHost} from '@nestjs/core';
import {Request} from 'express';
import {STATUS_CODES} from 'node:http';

import {isMcpRequest} from '@core/personal-access-token/mcp-request';
import {EMAIL_NOT_VERIFIED} from '@modules/auth/api/constants/api-messages.constants';

/** Parser failures happen before a controller filter can run and may carry the raw request body. */
@Catch()
export class McpExceptionFilter implements ExceptionFilter {
	constructor(private readonly adapterHost: HttpAdapterHost) {}

	catch(exception: unknown, host: ArgumentsHost) {
		const adapter = this.adapterHost.httpAdapter;
		if (!isMcpRequest(host.switchToHttp().getRequest<Request>())) {
			return new BaseExceptionFilter(adapter).catch(exception, host);
		}
		let status = 500;
		if (exception instanceof HttpException) status = exception.getStatus();
		else if (
			exception instanceof Error &&
			'status' in exception &&
			[400, 413, 415].includes(Number(exception.status))
		) {
			status = Number(exception.status);
		}
		let message = STATUS_CODES[status] ?? 'Internal Server Error';
		if (exception instanceof HttpException && status === 403) {
			const body = exception.getResponse();
			if (typeof body === 'object' && 'message' in body && body.message === EMAIL_NOT_VERIFIED)
				message = EMAIL_NOT_VERIFIED;
		}
		const response = host.switchToHttp().getResponse();
		if (adapter.isHeadersSent(response)) adapter.end(response);
		else adapter.reply(response, {statusCode: status, message}, status);
	}
}
