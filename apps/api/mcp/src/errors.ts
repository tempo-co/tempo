/** Only static messages and a narrowly validated Retry-After may cross the tool boundary. */
export class ToolReadError extends Error {
	constructor(status: number | 'network' | 'invalid-json', retryAfter?: string | null) {
		if (status === 'network') {
			super('Tempo network request failed or timed out. Check TEMPO_API_URL and API availability.');
			return;
		}
		if (status === 'invalid-json') {
			super('Tempo API returned invalid JSON. Check API availability.');
			return;
		}
		const messages: Record<number, string> = {
			401: 'Token rejected or expired. Check TEMPO_API_TOKEN.',
			403: 'Permission denied. Check token scope and account access.',
			404: 'Resource not found or not accessible to this token.',
			429: 'Rate limit reached. Retry later.',
		};
		let message =
			messages[status] ??
			(status >= 300 && status < 400
				? 'Redirect refused. Set TEMPO_API_URL to the final API base URL.'
				: status >= 500
					? 'Tempo API unavailable. Retry later.'
					: 'Request refused. Check tool input.');
		if (
			status === 429 &&
			retryAfter &&
			(/^\d{1,10}$/.test(retryAfter) ||
				/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter))
		) {
			message += ` Retry-After: ${retryAfter}`;
		}
		super(`Tempo API HTTP ${status}: ${message}`);
	}
}
