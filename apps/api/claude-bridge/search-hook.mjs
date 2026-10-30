// Claude Code PreToolUse hook for the search route: allows one WebSearch with exactly the query the bridge pinned
// for this request. Anything else is denied; with dontAsk, a crash or missing decision is a denial too.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const decide = (permissionDecision) =>
	process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision}}));

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
try {
	const {cwd, tool_name: tool, tool_input: input} = JSON.parse(raw);
	const {query} = JSON.parse(await readFile(path.join(cwd, 'search.json'), 'utf8'));
	if (
		tool !== 'WebSearch' ||
		typeof query !== 'string' ||
		input?.query !== query ||
		!Object.keys(input).every((key) => key === 'query' || (key === 'mode' && input.mode === 'standard'))
	)
		throw new Error();
	// Exclusive create: a second search in the same request finds the marker and is denied.
	await writeFile(path.join(cwd, 'search.used'), '', {flag: 'wx'});
	decide('allow');
} catch {
	decide('deny');
}
