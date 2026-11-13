import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {CsvLayout} from '../parsers/csv-layout';
import {NormalizedStatement, ParseRefusal, ParseRefusalCode, ParseResult} from '../parsers/parse-result';
import {TableSample} from '../parsers/table-sample';
import {ParseChildRequest} from './parse-runner.protocol';
import {validateParseOutput, validatePreviewOutput, validateSampleOutput} from './validate-parse-output';

export const PARSE_MEMORY_LIMIT_MB = 256;
export const PARSE_TIMEOUT_MS = 10_000;
export const PARSE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

type ChildFailure = {ok: false; code: 'parse_failed' | 'parse_timeout'};

export type ParseOutcome =
	| {ok: true; result: ParseResult}
	/** `layout`: on `layout_not_recognized` only, the id of the CSV layout the file looked like. */
	| {ok: false; code: ParseRefusalCode | 'parse_timeout'; layout?: string};

export type SampleOutcome = {ok: true; sample: TableSample} | {ok: false; code: ParseRefusalCode | 'parse_timeout'};

export type PreviewOutcome =
	| {ok: true; statements: NormalizedStatement[]; dateCheck: {written: string; date: string} | null}
	| {ok: false; code: ParseRefusalCode | 'parse_timeout' | 'layout_not_mappable'};

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
 * Parses one file in a fresh child process with an empty environment and no inherited stdio: the owner's saved
 * layouts and the bytes go in on stdin and normalized rows come back as JSON on stdout. A crash, signal, timeout,
 * oversized or invalid answer is a refusal, never an exception.
 */
export async function runParseChild(
	bytes: Buffer,
	options: ParseChildOptions = {},
	owned: readonly CsvLayout[] = [],
): Promise<ParseOutcome> {
	const output = await runChild({mode: 'parse', layouts: [...owned]}, bytes, options);
	if (!output.ok) return output;
	return checked(() => validateParseOutput(output.value, owned));
}

/** Finds and masks the file's table in a child process, as `runParseChild` runs it. */
export async function sampleInChild(bytes: Buffer, options: ParseChildOptions = {}): Promise<SampleOutcome> {
	const output = await runChild({mode: 'sample'}, bytes, options);
	if (!output.ok) return output;
	return checked(() => validateSampleOutput(output.value));
}

/** Reads the whole file with one proposed layout in a child process, as `runParseChild` runs it. */
export async function previewInChild(
	bytes: Buffer,
	layout: CsvLayout,
	options: ParseChildOptions = {},
): Promise<PreviewOutcome> {
	const output = await runChild({mode: 'preview', layout}, bytes, options);
	if (!output.ok) return output;
	return checked(() => validatePreviewOutput(output.value, layout));
}

/** A validator's answer; a validator that refuses the output makes it the refusal it names. */
function checked<T>(validate: () => T): T | {ok: false; code: ParseRefusalCode} {
	try {
		return validate();
	} catch (error) {
		return {ok: false, code: error instanceof ParseRefusal ? error.code : 'parse_failed'};
	}
}

function runChild(
	request: ParseChildRequest,
	bytes: Buffer,
	options: ParseChildOptions,
): Promise<{ok: true; value: unknown} | ChildFailure> {
	const timeoutMs = options.timeoutMs ?? PARSE_TIMEOUT_MS;
	const maxOutputBytes = options.maxOutputBytes ?? PARSE_MAX_OUTPUT_BYTES;

	return new Promise((resolve) => {
		const child = spawn(process.execPath, options.args ?? parseChildArgs(), {
			env: {},
			stdio: ['pipe', 'pipe', 'ignore'],
		});
		const chunks: Buffer[] = [];
		let outputBytes = 0;
		let failure: ChildFailure['code'] | null = null;
		const stop = (reason: ChildFailure['code']) => {
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
			try {
				resolve({ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown});
			} catch {
				resolve({ok: false, code: 'parse_failed'});
			}
		});
		child.stdin.write(`${JSON.stringify(request)}\n`);
		child.stdin.end(bytes);
	});
}
