export function createApiReader({apiUrl, apiToken}: {apiUrl: string; apiToken: string}) {
	return async (path: string, query?: Record<string, string> | URLSearchParams) => {
		const url = new URL(`${apiUrl}${path}`);
		if (query) url.search = new URLSearchParams(query).toString();
		const error = (text: string) => ({isError: true, content: [{type: 'text' as const, text}]});
		let response: Response;
		try {
			response = await fetch(url, {
				method: 'GET',
				headers: {Authorization: `Bearer ${apiToken}`},
				redirect: 'manual',
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			return error('Tempo network request failed or timed out. Check TEMPO_API_URL and API availability.');
		}
		if (!response.ok) {
			await response.body?.cancel();
			const messages: Record<number, string> = {
				401: 'Token rejected or expired. Check TEMPO_API_TOKEN.',
				403: 'Permission denied. Check token scope and account access.',
				404: 'Resource not found or not accessible to this token.',
				429: 'Rate limit reached. Retry later.',
			};
			let message =
				messages[response.status] ??
				(response.status >= 300 && response.status < 400
					? 'Redirect refused. Set TEMPO_API_URL to the final API base URL.'
					: response.status >= 500
						? 'Tempo API unavailable. Retry later.'
						: 'Request refused. Check tool input.');
			const retryAfter = response.headers.get('Retry-After');
			if (
				response.status === 429 &&
				retryAfter &&
				(/^\d{1,10}$/.test(retryAfter) ||
					/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter))
			)
				message += ` Retry-After: ${retryAfter}`;
			return error(`Tempo API HTTP ${response.status}: ${message}`);
		}
		try {
			return {content: [{type: 'text' as const, text: JSON.stringify(await response.json())}]};
		} catch {
			return error('Tempo API returned invalid JSON. Check API availability.');
		}
	};
}
