import type {Message, MessageCreateParamsNonStreaming} from '@anthropic-ai/sdk/resources/messages';

/**
 * The log line for one billed Claude API reply: what the call was for, how many items it carried, and its counts. It
 * never holds request or reply content.
 */
export function formatClaudeUsage(
	call: {kind: string; items: number},
	request: MessageCreateParamsNonStreaming,
	response: Pick<Message, 'stop_reason' | 'usage'>,
	ms: number,
): string {
	const {usage} = response;
	return (
		`Claude ${call.kind} call: items ${call.items}, ${request.model} ${request.output_config?.effort ?? 'default'}, ` +
		`${ms} ms, stop ${response.stop_reason}, input ${usage.input_tokens}, ` +
		`cache read ${usage.cache_read_input_tokens ?? 0}, cache write ${usage.cache_creation_input_tokens ?? 0}, ` +
		`output ${usage.output_tokens}, web searches ${usage.server_tool_use?.web_search_requests ?? 0}`
	);
}
