import Anthropic from '@anthropic-ai/sdk';
import type {MessageCreateParamsNonStreaming} from '@anthropic-ai/sdk/resources/messages';
import {Injectable, Logger, Optional} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {z} from 'zod';

import {ConfigurationService} from '@core/config/config.service';

import contract from '../../../../../../ops/claude-bridge/contract.json';
import {normalizeBankTransactionLocation} from '../../bank-transaction-location';
import {normalizeMerchantCategoryCode} from '../bank-transaction-categorization-input';
import {BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS} from '../bank-transaction-categorization.constants';
import {
	BankTransactionCategorizationProvider,
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from '../bank-transaction-categorization.provider';
import {
	BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES,
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationWebSearchInput,
	BankTransactionCategoryDefinition,
} from '../bank-transaction-categorization.types';
import {BANK_TRANSACTION_CATEGORIES} from '../bank-transaction-category';

const categorizationClassificationSchema = z
	.object({
		correlationId: z.string().min(1),
		category: z.enum(BANK_TRANSACTION_CATEGORIES),
		confidence: z.number().min(0).max(1),
	})
	.strict();

const categorizationResponseSchema = z
	.object({
		classifications: z.array(categorizationClassificationSchema),
	})
	.strict();
const webSearchCategorizationClassificationSchema = categorizationClassificationSchema.extend({
	evidenceType: z.enum(BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES),
});
const webSearchCategorizationResponseSchema = z
	.object({
		classifications: z.array(webSearchCategorizationClassificationSchema),
	})
	.strict();

// One source for the prompts and schemas, shared with the host-installed subscription bridge.
const {instructions: CATEGORIZATION_INSTRUCTIONS, schema: categorizationResponseJsonSchema} = contract;
const {instructions: WEB_SEARCH_CATEGORIZATION_INSTRUCTIONS, schema: webSearchCategorizationResponseJsonSchema} =
	contract.webSearch;
const CLAUDE_API = 'claude-api';
const CLAUDE_SUBSCRIPTION = 'claude-subscription';
type ClaudeRoute = typeof CLAUDE_API | typeof CLAUDE_SUBSCRIPTION;
type SearchTrace = {queries: string[]; sourceDomains: string[]};

type ClaudeClient = Pick<Anthropic, 'messages'>;
type RequestInput = {correlationId: string};
const CONTRACT_HASH = createHash('sha256').update(JSON.stringify(contract)).digest('hex');
const API_TIMEOUT_MS = 90_000;
const SUBSCRIPTION_TIMEOUT_MS = 125_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

@Injectable()
export class ClaudeBankTransactionCategorizationProvider implements BankTransactionCategorizationProvider {
	private readonly logger = new Logger(ClaudeBankTransactionCategorizationProvider.name);
	private client?: ClaudeClient;
	private readonly model: string;
	private readonly apiKey?: string;
	private readonly subscriptionSocket?: string;

	constructor(configurationService: ConfigurationService, @Optional() client?: ClaudeClient) {
		this.model = configurationService.get('AI_CATEGORIZATION_MODEL');
		this.apiKey = configurationService.get('ANTHROPIC_API_KEY');
		this.subscriptionSocket = configurationService.get('AI_CATEGORIZATION_SUBSCRIPTION_SOCKET');
		this.client = client;
	}

	async categorize(
		transactions: readonly BankTransactionCategorizationInput[],
		categories: readonly BankTransactionCategoryDefinition[],
	): Promise<readonly BankTransactionCategorizationResult[]> {
		this.assertUniqueCorrelationIds(transactions);
		if (!transactions.length) return [];
		const requestTransactions = transactions.map((transaction, index) => ({
			...this.toSafeInput(transaction),
			correlationId: String(index),
		}));
		const input = this.createInput(categories, requestTransactions);
		try {
			const response = await this.callApi(
				this.createRequest(CATEGORIZATION_INSTRUCTIONS, input, categorizationResponseJsonSchema, 8192),
			);
			return this.parseResults(this.parseJson(response.text), transactions, CLAUDE_API);
		} catch {
			// A billing/quota/transport failure must never turn into a category or a paid alternative.
			if (!this.subscriptionSocket) throw new BankTransactionCategorizationUnavailableError();
			try {
				const response = await this.callSubscription(input);
				return this.parseResults(this.parseJson(response), transactions, CLAUDE_SUBSCRIPTION);
			} catch {
				throw new BankTransactionCategorizationUnavailableError();
			}
		}
	}

	async categorizeWithWebSearch(
		transactions: readonly BankTransactionCategorizationWebSearchInput[],
		categories: readonly BankTransactionCategoryDefinition[],
	): Promise<readonly BankTransactionCategorizationResult[]> {
		this.assertUniqueCorrelationIds(transactions);
		const results: BankTransactionCategorizationResult[] = [];
		for (const transaction of transactions) {
			const input = this.createInput(categories, [
				{
					correlationId: '0',
					amount: transaction.amount,
					currency: transaction.currency,
					direction: transaction.direction,
					transactionType: transaction.transactionType,
					merchantName: transaction.merchantName,
					merchantLocation: transaction.merchantLocation,
					searchQuery: transaction.searchQuery,
					merchantCategoryCode: normalizeMerchantCategoryCode(transaction.merchantCategoryCode),
				},
			]);
			const request = this.createRequest(
				WEB_SEARCH_CATEGORIZATION_INSTRUCTIONS,
				input,
				webSearchCategorizationResponseJsonSchema,
				4096,
			);
			request.tools = [{type: 'web_search_20250305', name: 'web_search', max_uses: 1}];
			const {provider, output, domains} = await this.searchOnce(request, input, transaction.searchQuery);
			results.push(
				...(output === undefined
					? [this.failedSearch(transaction.correlationId, provider)]
					: this.parseResults(output, [transaction], provider, {
							queries: [transaction.searchQuery],
							sourceDomains: domains,
						})),
			);
		}
		return results;
	}

	/**
	 * Runs the row's one search: on the API, or on the subscription bridge when the API refused the request outright.
	 * After a timeout or an incomplete reply the search may already have run, so there is no second attempt. When the
	 * API refused and the subscription refused too, nothing searched, so the row stays pending for a retry.
	 */
	private async searchOnce(
		request: MessageCreateParamsNonStreaming,
		input: object,
		query: string,
	): Promise<{provider: ClaudeRoute; output?: unknown; domains: string[]}> {
		let response;
		try {
			response = await this.callApi(request);
		} catch (error) {
			if (!this.refusedBeforeRunning(error)) return {provider: CLAUDE_API, domains: []};
			if (!this.subscriptionSocket) {
				// Without a fallback, wait only for refusals that clear on their own, not a request the API always rejects.
				if (this.transientRefusal(error)) throw new BankTransactionCategorizationUnavailableError();
				return {provider: CLAUDE_API, domains: []};
			}
		}
		if (response) {
			// The bridge's hook enforces the query before searching; on the API it can only be checked afterwards.
			if (response.queries.length !== 1 || response.queries[0] !== query) throw this.invalidResponseError();
			return {provider: CLAUDE_API, output: this.parseJson(response.text), domains: response.domains};
		}
		let reply: string;
		try {
			reply = await this.callSubscription(input, '/categorize-with-search');
		} catch (error) {
			if (error instanceof BankTransactionCategorizationUnavailableError) throw error;
			return {provider: CLAUDE_SUBSCRIPTION, domains: []};
		}
		try {
			const {sourceDomains, ...output} = this.parseJson(reply) as {sourceDomains?: unknown};
			return {provider: CLAUDE_SUBSCRIPTION, output, domains: this.toSourceDomains(sourceDomains)};
		} catch {
			return {provider: CLAUDE_SUBSCRIPTION, domains: []};
		}
	}

	private failedSearch(correlationId: string, provider: ClaudeRoute): BankTransactionCategorizationResult {
		return {
			correlationId,
			category: 'NEEDS_REVIEW',
			confidence: 0,
			provider,
			model: this.model,
			searchTrace: {queries: [], sourceDomains: [], evidenceType: 'INSUFFICIENT'},
		};
	}

	private createRequest(
		system: string,
		input: object,
		schema: object,
		maxTokens: number,
	): MessageCreateParamsNonStreaming {
		return {
			model: this.model,
			max_tokens: maxTokens,
			system,
			messages: [{role: 'user', content: JSON.stringify(input)}],
			thinking: {type: 'adaptive'},
			output_config: {effort: 'medium', format: {type: 'json_schema', schema: schema as Record<string, unknown>}},
		};
	}

	private async callApi(
		request: MessageCreateParamsNonStreaming,
	): Promise<{text: string; domains: string[]; queries: unknown[]}> {
		if (!this.apiKey && !this.client) throw new BankTransactionCategorizationUnavailableError();
		const client =
			this.client ??
			(this.client = new Anthropic({
				apiKey: this.apiKey,
				maxRetries: 0,
				timeout: API_TIMEOUT_MS,
				logLevel: 'off',
			}));
		const response = await client.messages.create(request);
		if (response.stop_reason !== 'end_turn') throw this.invalidResponseError();
		const lastSearch = response.content.findLastIndex((block) => block.type === 'web_search_tool_result');
		const text = response.content
			.slice(lastSearch + 1)
			.flatMap((block) => (block.type === 'text' ? [block.text] : []))
			.join('');
		if (!text.trim()) throw this.invalidResponseError();
		const queries = response.content.flatMap((block) =>
			block.type === 'server_tool_use' && block.name === 'web_search'
				? [(block.input as {query?: unknown} | null)?.query]
				: [],
		);
		if (queries.length !== (response.usage.server_tool_use?.web_search_requests ?? 0))
			throw this.invalidResponseError();
		const hostnames: string[] = [];
		for (const block of response.content) {
			if (block.type !== 'web_search_tool_result') continue;
			if (!Array.isArray(block.content)) throw this.invalidResponseError();
			for (const result of block.content) {
				try {
					const url = new URL(result.url);
					if (url.protocol === 'https:' || url.protocol === 'http:') hostnames.push(url.hostname);
				} catch {
					continue;
				}
			}
		}
		return {text, domains: this.toSourceDomains(hostnames), queries};
	}

	/** Refusals that clear on their own: no key, auth, rate limit, overload. */
	private transientRefusal(error: unknown): boolean {
		if (error instanceof BankTransactionCategorizationUnavailableError) return true;
		const status = (error as {status?: unknown} | null)?.status;
		return typeof status === 'number' && [401, 403, 429, 529].includes(status);
	}

	/** An HTTP refusal (billing, auth, rate limit, overload) means the request, and so its search, never ran. */
	private refusedBeforeRunning(error: unknown): boolean {
		if (error instanceof BankTransactionCategorizationUnavailableError) return true;
		const status = (error as {status?: unknown} | null)?.status;
		// 408 is a timeout: the request may have run.
		return typeof status === 'number' && ((status >= 400 && status < 500 && status !== 408) || status === 529);
	}

	/** Keeps well-formed hostnames only, up to the trace limit. */
	private toSourceDomains(values: unknown): string[] {
		const domains = new Set<string>();
		for (const value of Array.isArray(values) ? values : []) {
			if (typeof value !== 'string') continue;
			const hostname = value.toLowerCase().replace(/^www\./, '');
			if (
				/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname) &&
				domains.size < BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS
			)
				domains.add(hostname);
		}
		return [...domains];
	}

	private parseJson(text: string): unknown {
		try {
			return JSON.parse(text);
		} catch {
			throw this.invalidResponseError();
		}
	}

	private parseResults(
		parsed: unknown,
		transactions: readonly RequestInput[],
		provider: ClaudeRoute,
		searchTrace?: SearchTrace,
	): BankTransactionCategorizationResult[] {
		const validation = (
			searchTrace ? webSearchCategorizationResponseSchema : categorizationResponseSchema
		).safeParse(parsed);
		if (!validation.success) throw this.invalidResponseError();
		const items = validation.data.classifications;
		const ids = new Set(items.map(({correlationId}) => correlationId));
		if (
			items.length !== transactions.length ||
			ids.size !== items.length ||
			transactions.some((_, index) => !ids.has(String(index)))
		)
			throw this.invalidResponseError();
		return items.map((item) => ({
			correlationId: transactions[Number(item.correlationId)].correlationId,
			category: item.category,
			confidence: item.confidence,
			provider,
			model: this.model,
			...(searchTrace && 'evidenceType' in item
				? {
						searchTrace: {
							...searchTrace,
							evidenceType:
								item.evidenceType as (typeof BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES)[number],
						},
					}
				: {}),
		}));
	}

	private callSubscription(input: object, path = '/categorize'): Promise<string> {
		return new Promise((resolve, reject) => {
			const body = JSON.stringify({model: this.model, input});
			const request = httpRequest(
				{
					socketPath: this.subscriptionSocket,
					method: 'POST',
					path,
					headers: {
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(body),
						'x-tempo-contract': CONTRACT_HASH,
					},
				},
				(response) => {
					let size = 0;
					const chunks: Buffer[] = [];
					response.on('data', (chunk: Buffer) => {
						size += chunk.length;
						if (size > MAX_RESPONSE_BYTES) request.destroy(new Error('Response limit.'));
						else chunks.push(chunk);
					});
					response.on('error', reject);
					response.on('end', () => {
						if (response.statusCode === 409)
							this.logger.warn('Claude bridge contract mismatch; reinstall and restart the bridge.');
						if (response.statusCode === 200) resolve(Buffer.concat(chunks).toString('utf8'));
						// The bridge refused before running (busy, unavailable, outdated contract): safe to retry.
						else if ([404, 409, 415, 503].includes(response.statusCode ?? 0))
							reject(new BankTransactionCategorizationUnavailableError());
						else reject(new Error('Subscription run failed.'));
					});
				},
			);
			const timer = setTimeout(
				() => request.destroy(new Error('Subscription timeout.')),
				SUBSCRIPTION_TIMEOUT_MS,
			);
			request.on('close', () => clearTimeout(timer));
			// No bridge listening: nothing ran. A timeout or a reply over the limit may come after a run.
			request.on('error', (error: NodeJS.ErrnoException) =>
				reject(
					['ENOENT', 'ECONNREFUSED', 'EACCES'].includes(error.code ?? '')
						? new BankTransactionCategorizationUnavailableError()
						: error,
				),
			);
			request.end(body);
		});
	}

	private createInput(
		categories: readonly BankTransactionCategoryDefinition[],
		transactions: readonly object[],
	): object {
		return {
			categories: categories.map(({value, label, description}) => ({value, label, description})),
			transactions,
		};
	}

	private assertUniqueCorrelationIds(transactions: readonly RequestInput[]): void {
		if (
			transactions.length > 50 ||
			new Set(transactions.map(({correlationId}) => correlationId)).size !== transactions.length
		)
			throw this.invalidResponseError();
	}

	private toSafeInput(transaction: BankTransactionCategorizationInput): BankTransactionCategorizationInput {
		const merchantLocation = normalizeBankTransactionLocation(transaction.merchantLocation);

		return {
			correlationId: transaction.correlationId,
			transactionDate: transaction.transactionDate,
			bookingDate: transaction.bookingDate,
			valueDate: transaction.valueDate,
			amount: transaction.amount,
			currency: transaction.currency,
			creditDebitIndicator: transaction.creditDebitIndicator,
			direction: transaction.direction,
			transactionType: transaction.transactionType,
			bankTransactionCode: transaction.bankTransactionCode,
			bankTransactionSubCode: transaction.bankTransactionSubCode,
			description: transaction.description,
			counterpartyName: transaction.counterpartyName,
			bankTransactionDescription: transaction.bankTransactionDescription,
			merchantCategoryCode: transaction.merchantCategoryCode,
			remittanceInformation: transaction.remittanceInformation,
			...(merchantLocation ? {merchantLocation} : {}),
			...(transaction.previousManualCategories?.length
				? {
						previousManualCategories: transaction.previousManualCategories.map(
							({category, count, recentExamples}) => ({
								category,
								count,
								recentExamples: recentExamples.map(({amount, currency, date}) => ({amount, currency, date})),
							}),
						),
					}
				: {}),
		};
	}

	private invalidResponseError(): BankTransactionCategorizationProviderError {
		return new BankTransactionCategorizationProviderError(
			'Claude returned an invalid categorization response.',
			true,
		);
	}
}
