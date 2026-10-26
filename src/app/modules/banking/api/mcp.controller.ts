import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Controller, Delete, Get, Post, Req, Res} from '@nestjs/common';
import {Throttle, minutes} from '@nestjs/throttler';
import {Request, Response} from 'express';

import {Account} from '@modules/account/account.entity';
import {CurrentAccount} from '@modules/auth/decorators/current-user.decorator';
import {McpTokenOnly} from '@modules/auth/decorators/mcp-token-only.decorator';

import {createToolServer} from '../../../../../mcp/src/tools';
import {McpReaderService} from '../services/mcp-reader.service';

@Controller('mcp')
@McpTokenOnly()
@Throttle({default: {limit: 300, ttl: minutes(1)}})
export class McpController {
	constructor(private readonly reader: McpReaderService) {}

	@Post()
	async post(@CurrentAccount() account: Account, @Req() request: Request, @Res() response: Response) {
		const server = createToolServer(this.reader.forAccount(account));
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			maxRequestBodySize: 100 * 1024,
		});
		const close = async () => {
			// Both paths are idempotent. Cleanup failures must not escape or log request data.
			await Promise.allSettled([server.close(), transport.close()]);
		};
		response.once('close', () => void close());
		try {
			await server.connect(transport);
			await transport.handleRequest(request, response, request.body);
		} catch {
			if (!response.headersSent) {
				response
					.status(500)
					.json({jsonrpc: '2.0', error: {code: -32603, message: 'Internal server error'}, id: null});
			} else if (!response.writableEnded) {
				response.end();
			}
			await close();
		}
	}

	@Get()
	get(@Res() response: Response) {
		this.methodNotAllowed(response);
	}

	@Delete()
	delete(@Res() response: Response) {
		this.methodNotAllowed(response);
	}

	private methodNotAllowed(response: Response) {
		response.setHeader('Allow', 'POST');
		response.status(405).json({jsonrpc: '2.0', error: {code: -32000, message: 'Method not allowed'}, id: null});
	}
}
