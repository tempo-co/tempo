import Anthropic from '@anthropic-ai/sdk';
import type {Message, MessageCreateParamsNonStreaming, Tool} from '@anthropic-ai/sdk/resources/messages';
import {Injectable, Logger, Optional} from '@nestjs/common';
import {BANK_TRANSACTION_CATEGORIES, type BankTransactionCategoryDefinition} from '@tempo/contracts';
import {z} from 'zod';

import {ConfigurationService} from '@core/config/config.service';
import {BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE} from '@core/queue/queue.constants';

import {normalizeBankTransactionText} from '../../bank-transaction-display';
import {isHostname, safeErrorName, truncate} from '../../banking.utils';
import {
	type BankTransactionCategorizationSearchFinding,
	MAX_SEARCH_FINDING_DESCRIPTION_LENGTH,
	MERCHANT_SEARCH_FINDING_KINDS,
	toCategorizationRequestTransaction,
	toSearchFinding,
} from '../bank-transaction-categorization-input.schema';
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
import contract from './claude-categorization-contract.json';
import merchantContract from './claude-merchant-contract.json';

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

const searchFindingResponseSchema = z
	.object({identifies: z.enum(MERCHANT_SEARCH_FINDING_KINDS), description: z.string().nullable()})
	.strict();

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

// The prompts and response schemas live in the contract files, the one source for them.
const {instructions: CATEGORIZATION_INSTRUCTIONS, schema: categorizationResponseJsonSchema} = contract;
const {instructions: SEARCH_INSTRUCTIONS, schema: searchFindingResponseJsonSchema} = contract.search;
const CLAUDE_API = 'claude-api';
type SearchTrace = Omit<BankTransactionCategorizationSearchTrace, 'evidenceType'>;

type ClaudeClient = Pick<Anthropic, 'messages'>;
type RequestInput = {correlationId: string};
type ClaudeEffort = NonNullable<NonNullable<MessageCreateParamsNonStreaming['output_config']>['effort']>;
const API_TIMEOUT_MS = 90_000;
// Refusals that clear on their own: authentication, permission, rate limit, overload.
const UNAVAILABLE_STATUSES = new Set([401, 403, 429, 529]);
// Anthropic answers an exhausted credit balance with 400 and this text, or with a billing error.
const CREDIT_BALANCE_PATTERN = /credit balance is too low/i;
// Adaptive thinking at high effort shares this budget with the reply, about 40 tokens per row of a 50-row group; a
// reply cut off at the limit fails the group rather than leaving it pending.
const CATEGORIZATION_MAX_TOKENS = 16_384;
// The merchant search reads one query and answers in a sentence, so it thinks briefly.
const SEARCH_EFFORT: ClaudeEffort = 'low';
const SEARCH_MAX_TOKENS = 4096;
// The categorizing call returns its answer as the input of this tool, which Tempo reads and never runs. A strict
// json_schema format made the model often skip thinking and send well-known merchants to review. Adaptive thinking
// rejects a forced tool choice, so the choice stays auto and the description asks for exactly one call.
const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';
const STRUCTURED_OUTPUT_DESCRIPTION =
	'Use this tool to return your final response in the requested structured format. You MUST call this tool exactly once at the end of your response to provide the structured output.';
const REPLY_BLOCKS = new Set(['text', 'thinking', 'redacted_thinking']);
const SEARCH_REPLY_BLOCKS = new Set([
	'text',
	'thinking',
	'redacted_thinking',
	'server_tool_use',
	'web_search_tool_result',
]);

@Injectable()
export class ClaudeBankTransactionCategorizationProvider implements BankTransactionCategorizationProvider {
	private readonly logger = new Logger(ClaudeBankTransactionCategorizationProvider.name);
	private client?: ClaudeClient;
	private readonly model: string;
	private readonly effort: ClaudeEffort;
	private readonly apiKey?: string;

	constructor(configurationService: ConfigurationService, @Optional() client?: ClaudeClient) {
		this.model = configurationService.get('AI_CATEGORIZATION_MODEL');
		// The config schema checks the value against the contract's effort list.
		this.effort = configurationService.get('AI_CATEGORIZATION_EFFORT') as ClaudeEffort;
		this.apiKey = configurationService.get('ANTHROPIC_API_KEY');
		this.client = client;
	}

	/**
	 * One call for a row group on the Anthropic API. With a `searchQuery`, it first runs a separate merchant search
	 * that sees only that query, then categorizes with its finding; a failed search leaves the call without one. The
	 * categorizing call offers no server tool, because the API cannot hold a model that sees the full input to the
	 * code-built query; it only offers the StructuredOutput tool that carries its answer.
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
		try {
			const search = searchQuery && this.hasApi() ? await this.searchMerchant(searchQuery) : undefined;
			const answer = await this.callStructuredOutput(
				this.createStructuredOutputRequest(
					CATEGORIZATION_INSTRUCTIONS,
					search?.finding ? {...input, searchFinding: search.finding} : input,
					categorizationResponseJsonSchema,
					CATEGORIZATION_MAX_TOKENS,
				),
			);
			return this.parseResults(answer, transactions, search?.trace);
		} catch (error) {
			// A billing/quota/transport failure must never turn into a category.
			throw this.callFailed(error);
		}
	}

	/**
	 * Runs at most one web search for a merchant in a call that receives only the code-built query, never transaction
	 * text, amounts, history or other names, so whatever query the model writes can reveal nothing else. Returns the
	 * trace only when a search ran, and with it a finding when the results identified a business; an answer from the
	 * model's own knowledge adds nothing the categorizing call lacks. Never throws: a failed search must not fail
	 * categorization.
	 */
	private async searchMerchant(
		searchQuery: string,
	): Promise<{finding?: BankTransactionCategorizationSearchFinding; trace: SearchTrace} | undefined> {
		try {
			const response = await this.createMessage({
				...this.createRequest(
					SEARCH_INSTRUCTIONS,
					{query: searchQuery},
					searchFindingResponseJsonSchema,
					SEARCH_MAX_TOKENS,
					SEARCH_EFFORT,
				),
				tools: [{type: 'web_search_20250305', name: 'web_search', max_uses: 1, allowed_callers: ['direct']}],
			});
			const searches = response.usage.server_tool_use?.web_search_requests ?? 0;
			const invocations = response.content.filter((block) => block.type === 'server_tool_use');
			// One search at most, counted both ways: an invocation the tool refused is not billed but still a second try.
			if (
				searches > 1 ||
				invocations.length > 1 ||
				response.content.some(
					(block) =>
						!SEARCH_REPLY_BLOCKS.has(block.type) ||
						(block.type === 'server_tool_use' && block.name !== 'web_search'),
				)
			)
				throw this.invalidResponseError();
			// A search that ran returns a list of results, possibly empty; a tool error is not a search.
			const results = response.content.flatMap((block) =>
				block.type === 'web_search_tool_result' && Array.isArray(block.content) ? [block.content] : [],
			);
			const ranQuery = (invocations[0]?.input as {query?: unknown} | undefined)?.query;
			if (searches === 0 || results.length === 0) return undefined;
			const parsed = searchFindingResponseSchema.safeParse(this.parseJson(this.replyText(response)));
			if (!parsed.success) throw this.invalidResponseError();
			const query = (typeof ranQuery === 'string' && this.toTraceQuery(ranQuery)) || searchQuery;
			const {identifies, description} = parsed.data;
			const trace = {
				queries: [query],
				sourceDomains: this.toSourceDomains(results.flat().map(({url}) => this.toHostname(url))),
			};
			// A search that ran but identified no business is no evidence: results for a name can be about anyone
			// sharing it, so the call decides from the transaction alone.
			if (identifies !== 'BUSINESS' && identifies !== 'PAYMENT_PROCESSOR') return {trace};
			const finding = toSearchFinding({
				query,
				identifies,
				description: truncate(description?.trim(), MAX_SEARCH_FINDING_DESCRIPTION_LENGTH),
			});
			if (!finding) throw this.invalidResponseError();
			return {finding, trace};
		} catch (error) {
			this.logger.warn(`Merchant web search failed; categorizing without it: ${safeErrorName(error)}`);
			return undefined;
		}
	}

	/**
	 * Names the business or payment service behind each merchant and its most likely official website. Fails like
	 * categorization: the unavailable error, which leaves the merchants pending without counting an attempt, when the
	 * API is unavailable; otherwise a provider error, so the attempt counts.
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
		try {
			const text = await this.callApi(
				this.createRequest(merchantContract.instructions, input, merchantContract.schema, 16384),
			);
			return this.parseMerchants(this.parseJson(text), merchants);
		} catch (error) {
			throw this.callFailed(error);
		}
	}

	/**
	 * The error for a call that got no usable answer. It is the unavailable error, which leaves rows pending for a
	 * retry without counting an attempt, only when the API refused before running and the refusal clears on its own
	 * ({@link isUnavailable}). Anything else may have run or would fail the same way again, so it is a retryable
	 * provider error with a bounded number of attempts.
	 */
	private callFailed(error: unknown): BankTransactionCategorizationProviderError {
		if (this.isUnavailable(error)) return new BankTransactionCategorizationUnavailableError();
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
		effort = this.effort,
	): MessageCreateParamsNonStreaming {
		return {
			model: this.model,
			max_tokens: maxTokens,
			system,
			messages: [{role: 'user', content: JSON.stringify(input)}],
			thinking: {type: 'adaptive'},
			output_config: {
				effort,
				format: {type: 'json_schema', schema: schema as Record<string, unknown>},
			},
		};
	}

	/**
	 * Like {@link createRequest}, but the answer comes back as the input of the StructuredOutput tool rather than
	 * through a json_schema format. The tool's input is not constrained to the schema; the caller validates it.
	 */
	private createStructuredOutputRequest(
		system: string,
		input: object,
		schema: object,
		maxTokens: number,
	): MessageCreateParamsNonStreaming {
		return {
			...this.createRequest(system, input, schema, maxTokens),
			// Replaces the json_schema format with effort alone.
			output_config: {effort: this.effort},
			tools: [
				{
					name: STRUCTURED_OUTPUT_TOOL,
					description: STRUCTURED_OUTPUT_DESCRIPTION,
					input_schema: schema as Tool.InputSchema,
				},
			],
			tool_choice: {type: 'auto', disable_parallel_tool_use: true},
		};
	}

	/** Sends a request that offers no tools and returns its reply text; a reply that used a tool is invalid. */
	private async callApi(request: MessageCreateParamsNonStreaming): Promise<string> {
		const response = await this.createMessage(request);
		if (response.content.some((block) => !REPLY_BLOCKS.has(block.type)) || this.ranServerTool(response))
			throw this.invalidResponseError();
		return this.replyText(response);
	}

	/**
	 * Sends a request that offers only the StructuredOutput tool and returns that tool call's input. The reply must
	 * stop to call it exactly once; a reply without the call, with another tool or a server tool is invalid.
	 */
	private async callStructuredOutput(request: MessageCreateParamsNonStreaming): Promise<unknown> {
		const response = await this.createMessage(request, 'tool_use');
		const calls = response.content.filter((block) => block.type === 'tool_use');
		if (
			calls.length !== 1 ||
			calls[0].name !== STRUCTURED_OUTPUT_TOOL ||
			response.content.some((block) => block.type !== 'tool_use' && !REPLY_BLOCKS.has(block.type)) ||
			this.ranServerTool(response)
		)
			throw this.invalidResponseError();
		return calls[0].input;
	}

	private ranServerTool(response: Message): boolean {
		return (response.usage.server_tool_use?.web_search_requests ?? 0) > 0;
	}

	private hasApi(): boolean {
		return !!this.apiKey || !!this.client;
	}

	/** Sends one API request and returns a complete reply, one that ended with the expected stop reason. */
	private async createMessage(
		request: MessageCreateParamsNonStreaming,
		stopReason: 'end_turn' | 'tool_use' = 'end_turn',
	): Promise<Message> {
		if (!this.hasApi()) throw new BankTransactionCategorizationUnavailableError();
		const client =
			this.client ??
			(this.client = new Anthropic({
				apiKey: this.apiKey,
				maxRetries: 0,
				timeout: API_TIMEOUT_MS,
				logLevel: 'off',
			}));
		const response = await client.messages.create(request);
		if (response.stop_reason !== stopReason) throw this.invalidResponseError();
		return response;
	}

	private replyText(response: Message): string {
		const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
		if (!text.trim()) throw this.invalidResponseError();
		return text;
	}

	/**
	 * Whether the API refused a call before running it, for a reason that clears without a code change: no key, an
	 * exhausted credit balance, authentication or permission, rate limit, overload, or a connection that never opened.
	 * A timeout is not one: the request may have run and been billed.
	 */
	private isUnavailable(error: unknown): boolean {
		if (error instanceof BankTransactionCategorizationUnavailableError) return true;
		if (error instanceof Anthropic.APIConnectionError)
			return !(error instanceof Anthropic.APIConnectionTimeoutError);
		const {
			status,
			type,
			message,
			error: body,
		} = (error ?? {}) as {
			status?: unknown;
			type?: unknown;
			message?: unknown;
			error?: {error?: {message?: unknown}};
		};
		if (typeof status !== 'number') return false;
		if (UNAVAILABLE_STATUSES.has(status) || status === 402 || type === 'billing_error') return true;
		// The SDK error's message repeats the body's; either one names the credit balance.
		return (
			status === 400 &&
			[body?.error?.message, message].some(
				(text) => typeof text === 'string' && CREDIT_BALANCE_PATTERN.test(text),
			)
		);
	}

	/** The query a search ran, as the trace stores it: control characters removed, within the query limit. */
	private toTraceQuery(query: string): string | null {
		const cleaned = query.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
		return truncate(cleaned, BANK_TRANSACTION_CATEGORIZATION_MAX_WEB_SEARCH_QUERY_LENGTH);
	}

	private toHostname(url: unknown): string | null {
		try {
			return typeof url === 'string' ? new URL(url).hostname : null;
		} catch {
			return null;
		}
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
			provider: CLAUDE_API,
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
