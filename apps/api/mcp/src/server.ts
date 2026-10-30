import {loadConfig} from './config.js';
import {createApiReader} from './api.js';
import {createToolServer} from './tools.js';

export interface ServerOptions {
	apiUrl?: string;
	apiToken?: string;
	now?: () => Date;
}

export function createServer(options: ServerOptions) {
	const config = loadConfig({TEMPO_API_URL: options.apiUrl, TEMPO_API_TOKEN: options.apiToken});
	return createToolServer(createApiReader(config), options.now);
}
