import {Injectable, Logger} from '@nestjs/common';

import {ConfigurationService} from '@core/config/config.service';

import {normalizeBankTransactionText} from '../../bank-transaction-display';
import {isHostname, truncate} from '../../banking.utils';
import {
	MAX_MERCHANT_SEARCH_RESULTS,
	MAX_MERCHANT_SEARCH_SNIPPET_LENGTH,
	MAX_MERCHANT_SEARCH_TITLE_LENGTH,
	type MerchantSearchResult,
} from '../bank-transaction-categorization-input.schema';

const API_URL = 'https://api.search.brave.com/res/v1/web/search';
const TIMEOUT_MS = 10_000;
// The countries Brave accepts for `country`; it refuses any other code, so those search all countries.
const BRAVE_COUNTRIES = new Set(
	'AR AU AT BE BR CA CL DK FI FR DE GR HK IN ID IT JP KR MY MX NL NZ NO CN PL PT PH RU SA ZA ES SE CH TW TR GB US'.split(
		' ',
	),
);

/** A search Brave refused or never answered with results: no key, or an HTTP status other than 200. */
export class BraveWebSearchError extends Error {
	constructor(readonly status: number | 'not_configured') {
		super(`Brave web search failed: ${status === 'not_configured' ? 'no key configured' : `HTTP ${status}`}`);
		this.name = 'BraveWebSearchError';
	}
}

type BraveResponse = {web?: {results?: {title?: unknown; url?: unknown; description?: unknown}[]}};

/**
 * Brave's web search API, asked with the code-built merchant query only. Returns the top results as plain text, which
 * the categorizing call reads and Wisp never stores. Throws on any failure; the caller decides without a search.
 */
@Injectable()
export class BraveWebSearchClient {
	private readonly logger = new Logger(BraveWebSearchClient.name);

	constructor(private readonly configurationService: ConfigurationService) {}

	/** Searches from `country` (the owner's bank country, ISO 3166 alpha-2) when Brave supports it, else worldwide. */
	async search(query: string, country?: string): Promise<MerchantSearchResult[]> {
		const key = this.configurationService.get('BRAVE_SEARCH_API_KEY');
		if (!key) throw new BraveWebSearchError('not_configured');
		const url = new URL(API_URL);
		url.search = new URLSearchParams({
			q: query,
			count: String(MAX_MERCHANT_SEARCH_RESULTS),
			result_filter: 'web',
			text_decorations: 'false',
			country: toBraveCountry(country),
		}).toString();
		const startedAt = Date.now();
		const response = await fetch(url, {
			headers: {'X-Subscription-Token': key, Accept: 'application/json'},
			redirect: 'error',
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (response.status !== 200) {
			await response.body?.cancel();
			throw new BraveWebSearchError(response.status);
		}
		const results = toMerchantSearchResults(await response.json());
		// Counts only: never the query or the results.
		this.logger.log(`Brave web search: ${Date.now() - startedAt} ms, results ${results.length}`);
		return results;
	}
}

export function toBraveCountry(country: string | undefined): string {
	const code = country?.trim().toUpperCase();
	return code && BRAVE_COUNTRIES.has(code) ? code : 'ALL';
}

/** The top web results as the model may see them: a title, the site's hostname and a bounded plain-text snippet. */
export function toMerchantSearchResults(body: unknown): MerchantSearchResult[] {
	const results = (body as BraveResponse | null)?.web?.results;
	if (!Array.isArray(results)) return [];
	return results.slice(0, MAX_MERCHANT_SEARCH_RESULTS).flatMap(({title, url, description}) => {
		const hostname = toHostname(url);
		const snippet = toPlainText(description, MAX_MERCHANT_SEARCH_SNIPPET_LENGTH);
		if (!hostname || !snippet) return [];
		return [{title: toPlainText(title, MAX_MERCHANT_SEARCH_TITLE_LENGTH), hostname, snippet}];
	});
}

function toHostname(url: unknown): string | null {
	try {
		const hostname = typeof url === 'string' ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : null;
		return hostname && isHostname(hostname) ? hostname : null;
	} catch {
		return null;
	}
}

function toPlainText(value: unknown, maxLength: number): string | null {
	if (typeof value !== 'string') return null;
	return truncate(normalizeBankTransactionText(value.replace(/<[^>]*>/g, ' ')), maxLength) ?? null;
}
