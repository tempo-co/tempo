import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createServer} from './server.js';

try {
	await createServer({apiUrl: process.env.TEMPO_API_URL, apiToken: process.env.TEMPO_API_TOKEN}).connect(
		new StdioServerTransport(),
	);
} catch (error) {
	const message =
		error instanceof Error && /^TEMPO_API_(TOKEN|URL)/.test(error.message)
			? error.message
			: 'Tempo MCP could not start.';
	console.error(message);
	process.exitCode = 1;
}
