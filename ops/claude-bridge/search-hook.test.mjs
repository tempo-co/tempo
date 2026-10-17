import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const hook = fileURLToPath(new URL('./search-hook.mjs', import.meta.url));

async function directory(t, query = 'Example Shop Utrecht') {
	const cwd = await mkdtemp(path.join(tmpdir(), 'tempo-search-hook-'));
	t.after(() => rm(cwd, {recursive: true, force: true}));
	if (query !== null) await writeFile(path.join(cwd, 'search.json'), JSON.stringify({query}));
	return cwd;
}

function decide(cwd, toolInput, toolName = 'WebSearch') {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [hook], {stdio: ['pipe', 'pipe', 'inherit']});
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		child.on('error', reject);
		child.on('close', () => resolve(JSON.parse(output).hookSpecificOutput.permissionDecision));
		child.stdin.end(
			JSON.stringify({hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput}),
		);
	});
}

test('allows exactly one search with the pinned query', async (t) => {
	const cwd = await directory(t);
	assert.equal(await decide(cwd, {query: 'Example Shop Utrecht', mode: 'standard'}), 'allow');
	assert.equal(await decide(cwd, {query: 'Example Shop Utrecht', mode: 'standard'}), 'deny');
});

test('denies any other query, option or tool', async (t) => {
	for (const [input, tool] of [
		[{query: 'Example Shop Utrecht reviews'}],
		[{query: 'Example Shop Utrecht', allowed_domains: ['example.test']}],
		[{query: 'Example Shop Utrecht', mode: 'deep'}],
		[{query: 'Example Shop Utrecht'}, 'WebFetch'],
		[null],
	]) {
		const cwd = await directory(t);
		assert.equal(await decide(cwd, input, tool), 'deny', JSON.stringify(input));
	}
});

test('denies when no pinned query exists', async (t) => {
	assert.equal(await decide(await directory(t, null), {query: 'Example Shop Utrecht'}), 'deny');
});
