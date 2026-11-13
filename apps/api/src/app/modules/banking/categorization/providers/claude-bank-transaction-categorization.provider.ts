import Anthropic from '@anthropic-ai/sdk';
import type {MessageCreateParamsNonStreaming} from '@anthropic-ai/sdk/resources/messages';
import {Injectable, Logger, Optional} from '@nestjs/common';
import {BANK_TRANSACTION_CATEGORIES, type BankTransactionCategoryDefinition} from '@tempo/contracts';
import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {z} from 'zod';

import {ConfigurationService} from '@core/config/config.service';
import {BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE} from '@core/queue/queue.constants';

import contract from '../../../../../../claude-bridge/contract.json';
import merchantContract from '../../../../../../claude-bridge/merchant-contract.json';
import {normalizeBankTransactionText} from '../../bank-transaction-display';
import {isHostname} from '../../banking.utils';
import {toCategorizationRequestTransaction} from '../bank-transaction-categorization-input.schema';
import {
	BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS,
	BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH,
} from '../bank-transaction-categorization.constants';
import {
	BankTransactionCategorizationProvider,
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from '../bank-transaction-categorization.provider';
import {
	BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES,
	BankTransactionCategorizationInput,
	BankTransactionCategorizationResult,
	BankTransactionCategorizationSearchTrace,
	MERCHANT_KINDS,
	MerchantIdentification,
	MerchantIdentificationInput,
} from '../bank-transaction-categorization.types';

const categorizationResponseSchema = z
	.object({
		classifications: z.array(
			z
				.object({
					correlationId: z.string().min(1),
					category: z.enum(BANK_TRANSACTION_CATEGORIES),
					confidence: z.number().min(0).max(1),
					evidenceType: z.enum(BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES),
				})
				.strict(),
		),
	})
	.strict();
/** What a stored search trace may hold: the one query that ran and well-formed source hostnames. */
const searchTraceSchema = z.object({
	queries: z
		.array(
			z
				.string()
				.min(1)
				.max(BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH)
				.regex(/^[^\u0000-\u001f\u007f]*$/),
		)
		.max(1),
	sourceDomains: z.array(z.string().refine(isHostname)).max(BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS),
	evidenceType: z.enum(BANK_TRANSACTION_CATEGORIZATION_SEARCH_EVIDENCE_TYPES),
});

const merchantIdentificationResponseSchema = z
	.object({
		merchants: z.array(
			z
				.object({
					correlationId: z.string().min(1),
					kind: z.enum(MERCHANT_KINDS),
					brand: z.string().nullable(),
					domain: z.string().nullable(),
					domainConfident: z.boolean(),
				})
				.strict(),
		),
	})
	.strict();

// One source for the prompts and schemas, shared with the host-installed subscription bridge.
const {instructions: CATEGORIZATION_INSTRUCTIONS, schema: categorizationResponseJsonSchema} = contract;
const CLAUDE_API = 'claude-api';
const CLAUDE_SUBSCRIPTION = 'claude-subscription';
type ClaudeRoute = typeof CLAUDE_API | typeof CLAUDE_SUBSCRIPTION;
type SearchTrace = Omit<BankTransactionCategorizationSearchTrace, 'evidenceType'>;

type ClaudeClient = Pick<Anthropic, 'messages'>;
type RequestInput = {correlationId: string};
type ClaudeEffort = NonNullable<NonNullable<MessageCreateParamsNonStreaming['output_config']>['effort']>;
const CONTRACT_HASH = createHash('sha256').update(JSON.stringify(contract)).digest('hex');
// Merchant identification has its own contract file, so changing it never affects the categorization routes.
const MERCHANT_CONTRACT_HASH = createHash('sha256').update(JSON.stringify(merchantContract)).digest('hex');
const API_TIMEOUT_MS = 90_000;
const SUBSCRIPTION_TIMEOUT_MS = 125_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
// Adaptive thinking at high effort shares this budget with the reply, about 40 tokens per row of a 50-row group; a
// reply cut off at the limit fails the group rather than leaving it pending.
const CATEGORIZATION_MAX_TOKENS = 16_384;

@Injectable()
export class ClaudeBankTransactionCategorizationProvider implements BankTransactionCategorizationProvider {
	private readonly logger = new Logger(ClaudeBankTransactionCategorizationProvider.name);
	private client?: ClaudeClient;
	private readonly model: string;
	private readonly effort: ClaudeEffort;
	private readonly apiKey?: string;
	private readonly subscriptionSocket?: string;

	constructor(configurationService: ConfigurationService, @Optional() client?: ClaudeClient) {
		this.model = configurationService.get('AI_CATEGORIZATION_MODEL');
		// The config schema checks the value against the bridge contract's effort list.
		this.effort = configurationService.get('AI_CATEGORIZATION_EFFORT') as ClaudeEffort;
		this.apiKey = configurationService.get('ANTHROPIC_API_KEY');
		this.subscriptionSocket = configurationService.get('AI_CATEGORIZATION_SUBSCRIPTION_SOCKET');
		this.client = client;
	}

	/**
	 * One call for a row group, on the API first and then on the subscription bridge. The API call never offers a web
	 * search, because the API cannot hold the model to the code-built query before it runs; rows its evidence can't
	 * settle go to NEEDS_REVIEW. Only the bridge receives a `searchQuery`, and its hook allows exactly that query.
	 */
	async categorize(
		transactions: readonly BankTransactionCategorizationInput[],
		categories: readonly BankTransactionCategoryDefinition[],
		{searchQuery}: {searchQuery?: string} = {},
	): Promise<readonly BankTransactionCategorizationResult[]> {
		this.assertUniqueCorrelationIds(transactions);
		if (!transactions.length) return [];
		const requestTransactions = transactions.map((transaction, index) => ({
			...toCategorizationRequestTransaction(transaction),
			correlationId: String(index),
		}));
		const input = this.createInput(categories, requestTransactions);
		let apiError: unknown;
		try {
			const text = await this.callApi(
				this.createRequest(
					CATEGORIZATION_INSTRUCTIONS,
					input,
					categorizationResponseJsonSchema,
					CATEGORIZATION_MAX_TOKENS,
				),
			);
			return this.parseResults(this.parseJson(text), transactions, CLAUDE_API);
		} catch (error) {
			// A billing/quota/transport failure must never turn into a category or a paid alternative.
			if (!this.subscriptionSocket) throw this.routesFailed(error, CLAUDE_API);
			apiError = error;
		}
		try {
			const bridgeInput = searchQuery ? {...input, searchQuery} : input;
			const {searched, sourceDomains, ...output} = this.parseJson(await this.callSubscription(bridgeInput)) as {
				searched?: unknown;
				sourceDomains?: unknown;
			};
			if (typeof searched !== 'boolean' || (searched && !searchQuery)) throw this.invalidResponseError();
			const searchTrace =
				searched && searchQuery
					? {queries: [searchQuery], sourceDomains: this.toSourceDomains(sourceDomains)}
					: undefined;
			return this.parseResults(output, transactions, CLAUDE_SUBSCRIPTION, searchTrace);
		} catch (error) {
			const failure = this.routesFailed(error, CLAUDE_SUBSCRIPTION);
			// Waiting for the bridge would repeat an API call that may already have run, so that attempt counts.
			if (failure instanceof BankTransactionCategorizationUnavailableError && this.mayHaveRun(apiError))
				throw this.routesFailed(apiError, CLAUDE_API);
			throw failure;
		}
	}

	/**
	 * Names the business or payment service behind each merchant and its most likely official website, on the
	 * same routes as categorization: the API first, then the subscription bridge. When both routes refused before the
	 * model ran, throws the unavailable error so the merchants stay pending without counting an attempt; when a model
	 * ran and its answer was unusable, throws a provider error so the attempt counts.
	 */
	async identifyMerchants(
		merchants: readonly MerchantIdentificationInput[],
	): Promise<readonly MerchantIdentification[]> {
		if (merchants.length > merchantContract.maxMerchants) throw this.invalidResponseError();
		this.assertUniqueCorrelationIds(merchants);
		if (!merchants.length) return [];
		const input = {
			merchants: merchants.map((merchant, index) => ({
				correlationId: String(index),
				name: merchant.name,
				location: merchant.location,
				transactionType: merchant.transactionType,
				direction: merchant.direction,
				searchSourceDomains: merchant.searchSourceDomains.slice(0, merchantContract.maxSourceDomains),
			})),
		};
		let ran = false;
		try {
			const text = await this.callApi(
				this.createRequest(merchantContract.instructions, input, merchantContract.schema, 16384),
			);
			return this.parseMerchants(this.parseJson(text), merchants);
		} catch (error) {
			ran = this.mayHaveRun(error);
		}
		if (this.subscriptionSocket) {
			try {
				const response = await this.callSubscription(input, '/identify-merchants', MERCHANT_CONTRACT_HASH);
				return this.parseMerchants(this.parseJson(response), merchants);
			} catch (error) {
				if (!(error instanceof BankTransactionCategorizationUnavailableError)) ran = true;
			}
		}
		throw ran ? this.invalidResponseError() : new BankTransactionCategorizationUnavailableError();
	}

	/**
	 * The error for a call that got no usable answer. It is the unavailable error, which leaves rows pending for a
	 * retry, only when nothing ran and a retry can succeed: the bridge refused before running, or, when the API is the
	 * only route, a refusal that clears on its own. Anything else may have run or would fail the same way again, so it
	 * is a retryable provider error with a bounded number of attempts.
	 */
	private routesFailed(error: unknown, route: ClaudeRoute): BankTransactionCategorizationProviderError {
		const retryLater =
			route === CLAUDE_SUBSCRIPTION
				? error instanceof BankTransactionCategorizationUnavailableError
				: this.transientRefusal(error);
		if (retryLater) return new BankTransactionCategorizationUnavailableError();
		if (
			error instanceof BankTransactionCategorizationProviderError &&
			!(error instanceof BankTransactionCategorizationUnavailableError)
		)
			return error;
		return new BankTransactionCategorizationProviderError('Claude categorization request failed.', true);
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
			output_config: {
				effort: this.effort,
				format: {type: 'json_schema', schema: schema as Record<string, unknown>},
			},
		};
	}

	/** Sends a request that offers no tools and returns its reply text; a reply that used a tool is invalid. */
	private async callApi(request: MessageCreateParamsNonStreaming): Promise<string> {
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
		if (
			response.content.some((block) => !['text', 'thinking', 'redacted_thinking'].includes(block.type)) ||
			(response.usage.server_tool_use?.web_search_requests ?? 0) > 0
		)
			throw this.invalidResponseError();
		const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
		if (!text.trim()) throw this.invalidResponseError();
		return text;
	}

	/** Refusals that clear on their own: no key, auth, rate limit, overload. */
	private transientRefusal(error: unknown): boolean {
		if (error instanceof BankTransactionCategorizationUnavailableError) return true;
		const status = (error as {status?: unknown} | null)?.status;
		return typeof status === 'number' && [401, 403, 429, 529].includes(status);
	}

	/** An HTTP refusal (billing, auth, rate limit, overload) means the request never ran. */
	private refusedBeforeRunning(error: unknown): boolean {
		if (error instanceof BankTransactionCategorizationUnavailableError) return true;
		const status = (error as {status?: unknown} | null)?.status;
		// 408 is a timeout: the request may have run.
		return typeof status === 'number' && ((status >= 400 && status < 500 && status !== 408) || status === 529);
	}

	/** Whether an API call may have reached the model: anything but a refusal or a connection that never opened. */
	private mayHaveRun(error: unknown): boolean {
		if (this.refusedBeforeRunning(error)) return false;
		return !(error instanceof Anthropic.APIConnectionError) || error instanceof Anthropic.APIConnectionTimeoutError;
	}

	/** Keeps well-formed hostnames only, up to the trace limit. */
	private toSourceDomains(values: unknown): string[] {
		const domains = new Set<string>();
		for (const value of Array.isArray(values) ? values : []) {
			if (typeof value !== 'string') continue;
			const hostname = value.toLowerCase().replace(/^www\./, '');
			if (isHostname(hostname) && domains.size < BANK_TRANSACTION_CATEGORIZATION_MAX_SEARCH_TRACE_ITEMS)
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
		const validation = categorizationResponseSchema.safeParse(parsed);
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
			...(searchTrace
				? {searchTrace: this.parseSearchTrace({...searchTrace, evidenceType: item.evidenceType})}
				: {}),
		}));
	}

	private parseSearchTrace(trace: SearchTrace & {evidenceType: unknown}): BankTransactionCategorizationSearchTrace {
		const validation = searchTraceSchema.safeParse(trace);
		if (!validation.success) throw this.invalidResponseError();
		return validation.data;
	}

	private parseMerchants(
		parsed: unknown,
		merchants: readonly MerchantIdentificationInput[],
	): MerchantIdentification[] {
		const validation = merchantIdentificationResponseSchema.safeParse(parsed);
		if (!validation.success) throw this.invalidResponseError();
		const items = validation.data.merchants;
		const ids = new Set(items.map(({correlationId}) => correlationId));
		if (
			items.length !== merchants.length ||
			ids.size !== items.length ||
			merchants.some((_, index) => !ids.has(String(index)))
		)
			throw this.invalidResponseError();
		return items.map((item) => {
			const named = item.kind === 'BUSINESS' || item.kind === 'PAYMENT_SERVICE';
			const normalized = named ? normalizeBankTransactionText(item.brand) : null;
			const brand = normalized && normalized.length <= merchantContract.maxBrandLength ? normalized : null;
			const domain = named
				? item.domain
						?.trim()
						.toLowerCase()
						.replace(/^www\./, '')
				: null;
			const validDomain = brand && domain && isHostname(domain) ? domain : null;
			return {
				correlationId: merchants[Number(item.correlationId)].correlationId,
				kind: item.kind,
				brand,
				domain: validDomain,
				domainConfident: !!validDomain && item.domainConfident,
			};
		});
	}

	private callSubscription(input: object, path = '/categorize', contractHash = CONTRACT_HASH): Promise<string> {
		return new Promise((resolve, reject) => {
			const body = JSON.stringify({model: this.model, effort: this.effort, input});
			const request = httpRequest(
				{
					socketPath: this.subscriptionSocket,
					method: 'POST',
					path,
					headers: {
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(body),
						'x-tempo-contract': contractHash,
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
			transactions.length > BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE ||
			new Set(transactions.map(({correlationId}) => correlationId)).size !== transactions.length
		)
			throw this.invalidResponseError();
	}

	private invalidResponseError(): BankTransactionCategorizationProviderError {
		return new BankTransactionCategorizationProviderError(
			'Claude returned an invalid categorization response.',
			true,
		);
	}
}
