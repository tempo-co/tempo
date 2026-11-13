/**
 * Runs in a short-lived child process: reads one file from stdin and writes a `ParseRunnerOutput` to stdout.
 * It imports only the parsers and Node built-ins, so it holds no database, Redis or network handle.
 */
import {parseFile} from '../parsers/parse-file';
import {MAX_FILE_BYTES} from '../parsers/parse-limits';
import {ParseRefusal, ParseRunnerOutput} from '../parsers/parse-result';

export async function runParseChild(input: AsyncIterable<Buffer>): Promise<ParseRunnerOutput> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of input) {
		size += chunk.length;
		if (size > MAX_FILE_BYTES) return {ok: false, code: 'file_too_large'};
		chunks.push(chunk);
	}
	try {
		return {ok: true, ...parseFile(Buffer.concat(chunks))};
	} catch (error) {
		if (!(error instanceof ParseRefusal)) return {ok: false, code: 'parse_failed'};
		return error.layout ? {ok: false, code: error.code, layout: error.layout} : {ok: false, code: error.code};
	}
}

if (require.main === module) {
	void runParseChild(process.stdin).then((output) => {
		process.stdout.write(JSON.stringify(output));
	});
}
