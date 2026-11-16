import Anthropic from '@anthropic-ai/sdk';
import type {MessageCreateParamsNonStreaming} from '@anthropic-ai/sdk/resources/messages';
import {Injectable, Optional} from '@nestjs/common';

import {ConfigurationService} from '@core/config/config.service';

import {
	LAYOUT_ANSWER_JSON_SCHEMA,
	LAYOUT_MAPPER_INSTRUCTIONS,
	LayoutAnswer,
	LayoutMapperInput,
	layoutAnswerSchema,
} from './layout-mapper.contract';

/** One call may take this long; it is never retried. */
export const LAYOUT_MAPPER_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 4096;

/** Why no layout came back: the model could not be asked (`unavailable`), or its answer was unusable (`invalid`). */
export class LayoutMapperError extends Error {
	constructor(readonly reason: 'unavailable' | 'invalid') {
		super(`Layout mapper ${reason}.`);
		this.name = 'LayoutMapperError';
	}
}

type ClaudeClient = Pick<Anthropic, 'messages'>;

/**
 * Works out a table's columns with one Anthropic API call: no tools, no retry, 30 seconds at most, and an answer in
 * the fixed schema. It needs `ANTHROPIC_API_KEY`; without it, or on any API failure, the mapper is unavailable.
 */
@Injectable()
export class LayoutMapper {
	private client?: ClaudeClient;
	private readonly apiKey?: string;
	private readonly model: string;

	constructor(configurationService: ConfigurationService, @Optional() client?: ClaudeClient) {
		this.apiKey = configurationService.get('ANTHROPIC_API_KEY');
		this.model = configurationService.get('FILE_IMPORT_MAPPER_MODEL');
		this.client = client;
	}

	async mapLayout(input: LayoutMapperInput): Promise<LayoutAnswer> {
		if (!this.apiKey) throw new LayoutMapperError('unavailable');
		const client =
			this.client ??
			(this.client = new Anthropic({
				apiKey: this.apiKey,
				maxRetries: 0,
				timeout: LAYOUT_MAPPER_TIMEOUT_MS,
				// Otherwise `ANTHROPIC_LOG=debug` prints raw upstream bodies.
				logLevel: 'off',
			}));
		const request: MessageCreateParamsNonStreaming = {
			model: this.model,
			max_tokens: MAX_TOKENS,
			system: LAYOUT_MAPPER_INSTRUCTIONS,
			messages: [{role: 'user', content: JSON.stringify(input)}],
			output_config: {
				effort: 'low',
				format: {type: 'json_schema', schema: LAYOUT_ANSWER_JSON_SCHEMA},
			},
		};
		let response: Awaited<ReturnType<ClaudeClient['messages']['create']>>;
		try {
			response = await client.messages.create(request, {timeout: LAYOUT_MAPPER_TIMEOUT_MS, maxRetries: 0});
		} catch {
			throw new LayoutMapperError('unavailable');
		}
		const message = response as Anthropic.Message;
		if (
			message.stop_reason !== 'end_turn' ||
			message.content.some((block) => !['text', 'thinking', 'redacted_thinking'].includes(block.type))
		) {
			throw new LayoutMapperError('invalid');
		}
		const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new LayoutMapperError('invalid');
		}
		const answer = layoutAnswerSchema.safeParse(parsed);
		if (!answer.success) throw new LayoutMapperError('invalid');
		return answer.data;
	}
}
