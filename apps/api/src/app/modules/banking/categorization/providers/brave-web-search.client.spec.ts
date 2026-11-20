import {Logger} from '@nestjs/common';

import {ConfigurationService} from '@core/config/config.service';

import {
	BraveWebSearchClient,
	BraveWebSearchError,
	toBraveCountry,
	toMerchantSearchResults,
} from './brave-web-search.client';

function client(key: string | null = 'synthetic-brave-key') {
	const config = {get: (name: string) => (name === 'BRAVE_SEARCH_API_KEY' ? (key ?? undefined) : undefined)};
	return new BraveWebSearchClient(config as unknown as ConfigurationService);
}

describe('BraveWebSearchClient', () => {
	let fetchSpy: jest.SpyInstance;
	let logSpy: jest.SpyInstance;

	beforeEach(() => {
		fetchSpy = jest.spyOn(globalThis, 'fetch');
		logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		logSpy.mockRestore();
	});

	it('asks for the top web results of the query alone and logs counts only', async () => {
		fetchSpy.mockResolvedValue(
			Response.json({
				web: {
					results: [{title: 'Example Cafe', url: 'https://www.cafe.example.test/', description: 'Coffee.'}],
				},
			}),
		);

		await expect(client().search('Example Cafe Example City', 'nl')).resolves.toEqual([
			{title: 'Example Cafe', hostname: 'cafe.example.test', snippet: 'Coffee.'},
		]);

		const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
		expect(url.origin + url.pathname).toBe('https://api.search.brave.com/res/v1/web/search');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			q: 'Example Cafe Example City',
			count: '5',
			result_filter: 'web',
			text_decorations: 'false',
			country: 'NL',
		});
		expect(init.headers).toEqual({'X-Subscription-Token': 'synthetic-brave-key', Accept: 'application/json'});
		const logged = JSON.stringify(logSpy.mock.calls);
		expect(logged).toContain('results 1');
		expect(logged).not.toMatch(/Example|synthetic-brave-key/);
	});

	it.each([
		['the key is missing', null, 200],
		['the API refuses the key', 'synthetic-brave-key', 401],
		['the plan is out of credit', 'synthetic-brave-key', 402],
		['the API is rate limited', 'synthetic-brave-key', 429],
	])('fails when %s', async (_case, key, status) => {
		fetchSpy.mockResolvedValue(new Response('{}', {status}));
		await expect(client(key).search('Example Cafe')).rejects.toEqual(
			new BraveWebSearchError(key ? status : 'not_configured'),
		);
	});
});

describe('toBraveCountry', () => {
	it.each([
		['NL', 'NL'],
		[' gb ', 'GB'],
		['RO', 'ALL'],
		[undefined, 'ALL'],
	])('searches from %j as %s', (country, expected) => {
		expect(toBraveCountry(country)).toBe(expected);
	});
});

describe('toMerchantSearchResults', () => {
	it('keeps at most five results as plain text with a bounded snippet, skipping ones without a site or text', () => {
		const result = (n: number, overrides: Record<string, unknown> = {}) => ({
			title: `Result <strong>${n}</strong>`,
			url: `https://site${n}.example.test/page?private=1`,
			description: `Snippet   ${n}`,
			...overrides,
		});
		expect(
			toMerchantSearchResults({
				web: {
					results: [
						result(1, {description: 'x'.repeat(600), title: undefined}),
						result(2, {url: 'not a url'}),
						result(3, {description: '  '}),
						result(4),
						result(5),
						result(6),
					],
				},
			}),
		).toEqual([
			{title: null, hostname: 'site1.example.test', snippet: 'x'.repeat(500)},
			{title: 'Result 4', hostname: 'site4.example.test', snippet: 'Snippet 4'},
			{title: 'Result 5', hostname: 'site5.example.test', snippet: 'Snippet 5'},
		]);
	});

	it.each([null, {}, {web: {}}, {web: {results: 'none'}}])('reads no results from %j', (body) => {
		expect(toMerchantSearchResults(body)).toEqual([]);
	});
});
