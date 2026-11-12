import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {createDeflateRaw} from 'node:zlib';

import {camt053, createZip} from '../../../../../test/fixtures/statement-file.fixture';
import {MAX_ARCHIVE_UNPACKED_BYTES, MAX_FILE_BYTES} from '../parsers/parse-limits';
import {PARSE_MEMORY_LIMIT_MB, parseChildArgs, runParseChild} from './parse-runner';

// Each case starts a real child process; the TypeScript entry compiles on start.
jest.setTimeout(30_000);

const script = (source: string) => ['-e', source];

describe('runParseChild', () => {
	it('parses a statement in a child process and returns validated rows', async () => {
		const outcome = await runParseChild(Buffer.from(camt53WithEntry()));

		expect(outcome).toEqual({
			ok: true,
			result: {
				files: 1,
				formats: ['camt053'],
				statements: [expect.objectContaining({rows: [expect.objectContaining({amount: '-12.50'})]})],
			},
		});
	});

	it.each([
		{
			name: 'XML that declares entities',
			file: () =>
				Buffer.from(
					camt53WithEntry().replace(
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>',
					),
				),
			code: 'parse_failed',
		},
		{
			// 1 GB of zeros deflates to about 1 MB, under the upload limit.
			name: 'a zip bomb',
			file: () => zipBomb(1024 * 1024 * 1024),
			code: 'archive_too_large',
		},
		{
			name: 'a file over the upload limit',
			file: () => Buffer.alloc(MAX_FILE_BYTES + 1, 0x20),
			code: 'file_too_large',
		},
	])('refuses $name with $code', async ({file, code}) => {
		const before = process.memoryUsage().rss;

		const outcome = await runParseChild(await file());

		expect(outcome).toEqual({ok: false, code});
		// The work happened in the child: this process did not take on the unpacked bytes.
		expect(process.memoryUsage().rss - before).toBeLessThan(MAX_ARCHIVE_UNPACKED_BYTES);
	});

	it('kills a parse that never returns and reports a timeout', async () => {
		const startedAt = Date.now();

		const outcome = await runParseChild(Buffer.from('x'), {
			args: script('setInterval(() => {}, 1000)'),
			timeoutMs: 500,
		});

		expect(outcome).toEqual({ok: false, code: 'parse_timeout'});
		expect(Date.now() - startedAt).toBeLessThan(5_000);
	});

	it.each([
		{name: 'crashes', args: script('process.exit(3)')},
		{
			name: 'runs out of memory',
			args: [
				`--max-old-space-size=${PARSE_MEMORY_LIMIT_MB}`,
				...script('const a = []; for (;;) a.push({x: a.length});'),
			],
		},
		{name: 'writes more than the output cap', args: script("process.stdout.write('x'.repeat(4096))")},
		{name: 'writes something that is not JSON', args: script("process.stdout.write('not json')")},
		{
			name: 'returns a refusal code it may not use',
			args: script(`process.stdout.write(JSON.stringify({ok: false, code: 'synced_account_not_supported_yet'}))`),
		},
		{
			name: 'returns rows that fail validation',
			args: script(
				`process.stdout.write(JSON.stringify({ok: true, files: 1, formats: ['camt053'], statements: [{format: 'camt053', accountIban: 'NL91ABNA0417164300', accountOtherId: null, bank: null, accountCurrency: 'EUR', sequenceNumber: null, entriesSkipped: 0, rows: [{amount: 12.5}]}]}))`,
			),
		},
	])('refuses a child that $name', async ({args}) => {
		const outcome = await runParseChild(Buffer.from('x'), {args, maxOutputBytes: 1024, timeoutMs: 20_000});

		expect(outcome).toEqual({ok: false, code: 'parse_failed'});
	});

	it('runs with an empty environment', async () => {
		process.env.EXAMPLE_PARENT_SECRET = 'example-only';
		try {
			const outcome = await runParseChild(Buffer.from('x'), {
				args: script(
					"process.stdout.write(JSON.stringify({ok: false, code: Object.keys(process.env).length === 0 ? 'unsupported_format' : 'parse_failed'}))",
				),
			});

			expect(outcome).toEqual({ok: false, code: 'unsupported_format'});
		} finally {
			delete process.env.EXAMPLE_PARENT_SECRET;
		}
	});

	it('loads no database, Redis, queue or Nest module in the child', () => {
		const [, ...loader] = parseChildArgs();
		const entry = loader.pop() as string;
		const listModules = `require(${JSON.stringify(entry)}); process.stdout.write(JSON.stringify(Object.keys(require.cache)));`;

		const run = spawnSync(process.execPath, [...loader, '-e', listModules], {env: {}, cwd: join(__dirname, '..')});
		const modules = JSON.parse(run.stdout.toString()) as string[];

		expect(modules).toContain(entry);
		expect(
			modules.filter((path) => /[\\/]node_modules[\\/](typeorm|@nestjs|ioredis|bullmq|pg)[\\/]/.test(path)),
		).toEqual([]);
	});
});

function camt53WithEntry(): string {
	return camt053([{entries: [{amount: '12.50', reference: 'EXAMPLE-1', info: 'Example Shop'}]}]);
}

/** A zip whose only entry inflates to `size` zero bytes but declares 100; built in chunks to stay small here. */
async function zipBomb(size: number): Promise<Buffer> {
	const deflate = createDeflateRaw({level: 9});
	const output: Buffer[] = [];
	deflate.on('data', (chunk: Buffer) => output.push(chunk));
	const done = new Promise((resolve) => deflate.on('end', resolve));
	const zeros = Buffer.alloc(16 * 1024 * 1024);
	for (let written = 0; written < size; written += zeros.length) {
		if (!deflate.write(zeros)) await new Promise((resolve) => deflate.once('drain', resolve));
	}
	deflate.end();
	await done;
	return createZip([
		{name: 'statement.xml', content: Buffer.alloc(0), deflated: Buffer.concat(output), declaredSize: 100},
	]);
}
