/**
 * Runs in a short-lived child process: reads one request line and one file from stdin and writes its answer as JSON
 * to stdout. It imports only the parsers and Node built-ins, so it holds no database, Redis or network handle.
 *
 * - `parse`: the file's statements, read with every built-in reader and then the owner's saved layouts.
 * - `sample`: where the file's table is and its masked sample for the column mapper.
 * - `preview`: the file's statements read with one proposed layout alone, and whether its dates need a check.
 */
import {CsvLayout, validateCsvLayout} from '../parsers/csv-layout';
import {readCsvLayout} from '../parsers/csv-layout-reader';
import {parseFile} from '../parsers/parse-file';
import {MAX_FILE_BYTES, MAX_ROWS_PER_DROP} from '../parsers/parse-limits';
import {ParseRefusal} from '../parsers/parse-result';
import {sampleTable} from '../parsers/table-sample';
import {MAX_REQUEST_BYTES, ParseChildOutput, ParseChildRequest} from './parse-runner.protocol';

export async function runParseChild(input: AsyncIterable<Buffer>): Promise<ParseChildOutput> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of input) {
		size += chunk.length;
		if (size > MAX_FILE_BYTES + MAX_REQUEST_BYTES) return {ok: false, code: 'file_too_large'};
		chunks.push(chunk);
	}
	const stdin = Buffer.concat(chunks);
	const newline = stdin.indexOf(0x0a);
	if (newline === -1 || newline > MAX_REQUEST_BYTES) return {ok: false, code: 'parse_failed'};
	let request: ParseChildRequest;
	try {
		request = JSON.parse(stdin.subarray(0, newline).toString('utf8')) as ParseChildRequest;
	} catch {
		return {ok: false, code: 'parse_failed'};
	}
	const bytes = stdin.subarray(newline + 1);
	if (bytes.length > MAX_FILE_BYTES) return {ok: false, code: 'file_too_large'};
	try {
		if (request?.mode === 'sample') {
			const sample = sampleTable(bytes);
			return sample ? {ok: true, sample} : {ok: false, code: 'unsupported_format'};
		}
		if (request?.mode === 'preview') {
			const validation = validateCsvLayout(request.layout);
			if (!validation.ok) return {ok: false, code: 'layout_not_mappable'};
			const read = readCsvLayout(bytes, [validation.layout], {owned: true});
			if (!read) return {ok: false, code: 'layout_not_mappable'};
			if (read.statements.reduce((rows, statement) => rows + statement.rows.length, 0) > MAX_ROWS_PER_DROP) {
				return {ok: false, code: 'too_many_rows'};
			}
			return {ok: true, statements: read.statements, dateCheck: read.dateCheck};
		}
		if (request?.mode === 'parse' && Array.isArray(request.layouts)) {
			// The parent sends only layouts it validated; anything else is left out rather than trusted.
			const owned = request.layouts.flatMap((value): CsvLayout[] => {
				const validation = validateCsvLayout(value);
				return validation.ok ? [validation.layout] : [];
			});
			return {ok: true, ...parseFile(bytes, owned)};
		}
		return {ok: false, code: 'parse_failed'};
	} catch (error) {
		if (!(error instanceof ParseRefusal)) return {ok: false, code: 'parse_failed'};
		// A layout the preview reads with matched the header but not the rows: it does not map the file.
		if (request.mode === 'preview') return {ok: false, code: 'layout_not_mappable'};
		return error.layout ? {ok: false, code: error.code, layout: error.layout} : {ok: false, code: error.code};
	}
}

if (require.main === module) {
	void runParseChild(process.stdin).then((output) => {
		process.stdout.write(JSON.stringify(output));
	});
}
