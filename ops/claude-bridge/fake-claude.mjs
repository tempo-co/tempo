// Synthetic subprocess used only by the bridge tests. Never invokes a provider.
const mode = process.argv[2];
const args = process.argv.slice(3);
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (args[0] === 'doctor') {
	if (mode === 'doctor-fail') process.exit(1);
} else if (args[0] === 'auth') {
	emit({
		loggedIn: mode !== 'logged-out',
		authMethod: mode === 'console-auth' ? 'api_key' : 'claude.ai',
		apiProvider: mode === 'third-party-auth' ? 'bedrock' : 'firstParty',
		subscriptionType: mode === 'enterprise-auth' ? 'enterprise' : 'max',
	});
} else {
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	const parsed = JSON.parse(input);
	if (mode !== 'no-init')
		emit({
			type: 'system',
			subtype: 'init',
			apiKeySource: mode === 'api-key' ? 'ANTHROPIC_API_KEY' : 'none',
			tools: mode === 'tools' ? ['StructuredOutput', 'Bash'] : ['StructuredOutput'],
			mcp_servers: mode === 'mcp' ? [{name: 'example', status: 'connected'}] : [],
		});
	if (mode === 'overage')
		emit({type: 'rate_limit_event', rate_limit_info: {isUsingOverage: true, status: 'allowed'}});
	if (mode === 'overage-allowed')
		emit({
			type: 'rate_limit_event',
			rate_limit_info: {status: 'allowed', isUsingOverage: false, overageStatus: 'allowed'},
		});
	if (mode === 'near-limit')
		emit({
			type: 'rate_limit_event',
			rate_limit_info: {status: 'allowed_warning', isUsingOverage: false, overageStatus: 'rejected'},
		});
	if (mode === 'near-limit-overage')
		emit({
			type: 'rate_limit_event',
			rate_limit_info: {status: 'allowed_warning', isUsingOverage: true, overageStatus: 'allowed'},
		});
	if (!['overage', 'overage-allowed', 'quota', 'no-rate-limit', 'near-limit', 'near-limit-overage'].includes(mode))
		emit({
			type: 'rate_limit_event',
			rate_limit_info: {status: 'allowed', isUsingOverage: false, overageStatus: 'rejected'},
		});
	if (mode === 'tool-call')
		emit({type: 'assistant', message: {content: [{type: 'tool_use', name: 'Bash', input: {command: 'example'}}]}});
	if (mode === 'delay') await new Promise((resolve) => setTimeout(resolve, 1200));
	if (mode === 'large-stdout') emit({type: 'system', subtype: 'status', data: 'x'.repeat(300 * 1024)});
	if (mode === 'large-stderr') process.stderr.write('x'.repeat(300 * 1024));
	if (mode === 'quota')
		emit({
			type: 'rate_limit_event',
			rate_limit_info: {status: 'rejected', isUsingOverage: false, overageStatus: 'rejected'},
		});
	if (mode === 'cli-error') {
		process.stderr.write('synthetic-sensitive-error');
		process.exit(1);
	}
	if (mode === 'bad-json') process.stdout.write('synthetic-sensitive-malformed-output\n');
	if (mode !== 'missing-result') {
		const classifications = parsed.transactions.map(({correlationId}) => ({
			correlationId,
			category: mode === 'bad-category' ? 'INVENTED' : 'SHOPPING',
			confidence: mode === 'bad-confidence' ? 4 : 0.9,
		}));
		if (mode === 'wrong-id') classifications[0].correlationId = 'unknown';
		if (mode === 'duplicate-id') classifications.push(classifications[0]);
		if (mode === 'missing-id') classifications.length = 0;
		emit({
			type: 'result',
			subtype: mode === 'failure-result' ? 'error_during_execution' : 'success',
			is_error: mode === 'failure-result',
			structured_output: {
				classifications,
				...(mode === 'extra-output-field' ? {secret: 'synthetic-secret'} : {}),
			},
		});
	}
}
