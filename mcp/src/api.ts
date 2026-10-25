import type {ToolReader} from './tools.js';
import {filterQuery} from './inputs.js';
import {ToolReadError} from './errors.js';

export function createApiReader({apiUrl, apiToken}: {apiUrl: string; apiToken: string}): ToolReader {
	const get = async (path: string, query?: Record<string, string> | URLSearchParams) => {
		const url = new URL(`${apiUrl}${path}`);
		if (query) url.search = new URLSearchParams(query).toString();
		let response: Response;
		try {
			response = await fetch(url, {
				method: 'GET',
				headers: {Authorization: `Bearer ${apiToken}`},
				redirect: 'manual',
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new ToolReadError('network');
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new ToolReadError(response.status, response.headers.get('Retry-After'));
		}
		try {
			return await response.json();
		} catch {
			throw new ToolReadError('invalid-json');
		}
	};
	return {
		listAccounts: () => get('/bank-connections'),
		monthSummary: (input) => get('/bank-transactions/summary', input),
		cashFlow: (input) => get('/bank-transactions/cash-flow', {...input}),
		balanceTrend: (input) => get('/bank-transactions/balance-trend', {...input}),
		searchTransactions: ({filters, page, pageSize}) => {
			const query = new URLSearchParams({
				'pagination[pageIndex]': String(page),
				'pagination[pageSize]': String(pageSize),
			});
			for (const [key, value] of filterQuery(filters)) query.append(key, value);
			return get('/bank-transactions', query);
		},
		transactionTotals: ({filters}) => get('/bank-transactions/totals', filterQuery(filters)),
		getTransaction: (id) => get(`/bank-transactions/${id}`),
		reviewCounts: () => get('/bank-transactions/review-counts'),
	};
}
