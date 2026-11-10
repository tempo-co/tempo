/** Only static messages may cross the tool boundary. */
export class ToolReadError extends Error {
	constructor(status: number) {
		const messages: Record<number, string> = {
			401: 'Token rejected or expired.',
			403: 'Permission denied. Check token scope and account access.',
			404: 'Resource not found or not accessible to this token.',
			429: 'Rate limit reached. Retry later.',
		};
		const message =
			messages[status] ??
			(status >= 500 ? 'Tempo API unavailable. Retry later.' : 'Request refused. Check tool input.');
		super(`Tempo API HTTP ${status}: ${message}`);
	}
}
