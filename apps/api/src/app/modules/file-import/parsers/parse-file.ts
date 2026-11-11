import {looksLikeCamt053, parseCamt053} from './camt053';
import {MAX_ROWS_PER_DROP} from './parse-limits';
import {NormalizedStatement, ParseRefusal, ParseResult} from './parse-result';
import {isZip, readZipEntries} from './zip-reader';

/**
 * Decides the format from the content alone and parses one uploaded file. A zip is unpacked one level: every
 * entry must itself be a supported statement, and an archive inside the archive is refused.
 */
export function parseFile(bytes: Uint8Array): ParseResult {
	const documents = isZip(bytes) ? readZipEntries(bytes) : [bytes];
	if (documents.length === 0) throw new ParseRefusal('unsupported_format');

	const statements: NormalizedStatement[] = [];
	let rows = 0;
	for (const document of documents) {
		if (isZip(document) || !looksLikeCamt053(document)) throw new ParseRefusal('unsupported_format');
		for (const statement of parseCamt053(document)) {
			rows += statement.rows.length;
			if (rows > MAX_ROWS_PER_DROP) throw new ParseRefusal('too_many_rows');
			statements.push(statement);
		}
	}
	return {format: 'camt053', files: documents.length, statements};
}
