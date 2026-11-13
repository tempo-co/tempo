import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {ParseRefusal, ParseRefusalCode, ParseResult} from '../parsers/parse-result';
import {validateParseOutput} from './validate-parse-output';

export const PARSE_MEMORY_LIMIT_MB = 256;
export const PARSE_TIMEOUT_MS = 10_000;
export const PARSE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export type ParseOutcome =
	| {ok: true; result: ParseResult}
	/** `layout`: on `layout_not_recognized` only, the id of the CSV layout the file looked like. */
	| {ok: false; code: ParseRefusalCode | 'parse_timeout'; layout?: string};

export type ParseChildOptions = {
	/** Arguments for `process.execPath`; the default runs the parse child with the memory cap. */
	args?: readonly string[];
	timeoutMs?: number;
	maxOutputBytes?: number;
};

/**
 * The command line of the parse child. The built app runs the compiled entry; a source checkout (Jest compiles
 * in memory and writes no `.js`) runs the TypeScript entry through ts-node.
 */
export function parseChildArgs(directory = __dirname): string[] {
	const memoryLimit = `--max-old-space-size=${PARSE_MEMORY_LIMIT_MB}`;
	const compiled = join(directory, 'parse-runner.child.js');
	if (existsSync(compiled)) return [memoryLimit, compiled];
	return [
		memoryLimit,
		'--require',
		require.resolve('ts-node/register/transpile-only'),
		join(directory, 'parse-runner.child.ts'),
	];
}

/**
 * Parses one file in a fresh child process with an empty environment and no inherited stdio: the bytes go in on
 * stdin and normalized rows come back as JSON on stdout. A crash, signal, timeout, oversized or invalid answer is
 * a refusal, never an exception.
 */
export function runParseChild(bytes: Buffer, options: ParseChildOptions = {}): Promise<ParseOutcome> {
	const timeoutMs = options.timeoutMs ?? PARSE_TIMEOUT_MS;
	const maxOutputBytes = options.maxOutputBytes ?? PARSE_MAX_OUTPUT_BYTES;

	return new Promise((resolve) => {
		const child = spawn(process.execPath, options.args ?? parseChildArgs(), {
			env: {},
			stdio: ['pipe', 'pipe', 'ignore'],
		});
		const chunks: Buffer[] = [];
		let outputBytes = 0;
		let failure: 'parse_failed' | 'parse_timeout' | null = null;
		const stop = (reason: 'parse_failed' | 'parse_timeout') => {
			failure ??= reason;
			child.kill('SIGKILL');
		};
		const timer = setTimeout(() => stop('parse_timeout'), timeoutMs);

		child.on('error', () => stop('parse_failed'));
		// A child that exits before reading all input closes the pipe; the exit status decides the outcome.
		child.stdin.on('error', () => undefined);
		child.stdout.on('data', (chunk: Buffer) => {
			outputBytes += chunk.length;
			if (outputBytes > maxOutputBytes) return stop('parse_failed');
			chunks.push(chunk);
		});
		child.on('close', (code, signal) => {
			clearTimeout(timer);
			if (failure) return resolve({ok: false, code: failure});
			if (code !== 0 || signal) return resolve({ok: false, code: 'parse_failed'});
			resolve(readOutput(Buffer.concat(chunks)));
		});
		child.stdin.end(bytes);
	});
}

function readOutput(stdout: Buffer): ParseOutcome {
	try {
		return validateParseOutput(JSON.parse(stdout.toString('utf8')));
	} catch (error) {
		return {ok: false, code: error instanceof ParseRefusal ? error.code : 'parse_failed'};
	}
}
