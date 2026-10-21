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
		subscriptionType: null,
	});
} else {
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	const parsed = JSON.parse(input);
	const searchRun = args[args.indexOf('--tools') + 1] === 'WebSearch';
	if (mode !== 'no-init')
		emit({
			type: 'system',
			subtype: 'init',
			apiKeySource: mode === 'api-key' ? 'ANTHROPIC_API_KEY' : 'none',
			tools:
				mode === 'tools'
					? ['StructuredOutput', 'Bash']
					: ['StructuredOutput', ...(searchRun ? ['WebSearch'] : [])],
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
	if (mode === 'standard-search')
		emit({type: 'assistant', message: {content: [{type: 'tool_use', name: 'WebSearch', input: {query: 'x'}}]}});
	const searches = {'search-none': 0, 'search-twice': 2}[mode] ?? 1;
	for (let i = 0; searchRun && i < searches; i++) {
		const query = mode === 'search-other-query' ? 'other query' : parsed.transactions[0].searchQuery;
		emit({
			type: 'assistant',
			message: {content: [{type: 'tool_use', id: `t${i}`, name: 'WebSearch', input: {query, mode: 'standard'}}]},
		});
		emit({
			type: 'user',
			message: {content: [{type: 'tool_result', tool_use_id: `t${i}`, is_error: mode === 'search-denied'}]},
			tool_use_result:
				mode === 'search-denied'
					? 'Error: denied'
					: {
							query,
							searchCount: 1,
							results: [
								{
									content: [
										{title: 'a', url: 'https://www.example.test/path?token=private'},
										{title: 'b', url: 'https://shop.example.test/'},
										{title: 'c', url: 'not a url'},
									],
								},
								'text summary',
							],
						},
		});
	}
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
			...(searchRun && mode !== 'search-no-evidence' ? {evidenceType: 'MERCHANT_IDENTITY_ONLY'} : {}),
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
