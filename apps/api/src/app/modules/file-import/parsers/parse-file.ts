import {looksLikeAbnAmroTxt, parseAbnAmroTxt} from './abn-amro-txt';
import {looksLikeCamt053, parseCamt053} from './camt053';
import {looksLikeMt940, parseMt940} from './mt940';
import {MAX_ROWS_PER_DROP} from './parse-limits';
import {NormalizedStatement, ParseRefusal, ParseResult, StatementFormat} from './parse-result';
import {looksLikeRevolutCsv, parseRevolutCsv, parseRevolutXlsx} from './revolut';
import {isXlsx} from './xlsx';
import {isZip, readZipEntries} from './zip-reader';

/** The signature of the old binary Office file (OLE2 compound document) that `.xls` workbooks are. */
const LEGACY_XLS_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

type Document = {format: StatementFormat; statements: NormalizedStatement[]};

/**
 * Decides the format from the content alone (never the name) and parses one uploaded file. A workbook is read as
 * a Revolut statement. Any other zip is unpacked one level: every entry must itself be a supported statement file,
 * in any mix of formats, and an archive or workbook inside the archive is refused.
 */
export function parseFile(bytes: Uint8Array): ParseResult {
	if (isZip(bytes) && isXlsx(bytes)) {
		return collect([bytes], () => ({format: 'revolutXlsx', statements: parseRevolutXlsx(bytes)}));
	}
	const documents = isZip(bytes) ? readZipEntries(bytes).map(({content}) => content) : [bytes];
	if (documents.length === 0) throw new ParseRefusal('unsupported_format');
	return collect(documents, parseDocument);
}

function collect(documents: readonly Uint8Array[], parse: (document: Uint8Array) => Document): ParseResult {
	const formats = new Set<StatementFormat>();
	const statements: NormalizedStatement[] = [];
	let rows = 0;
	for (const document of documents) {
		const {format, statements: parsed} = parse(document);
		formats.add(format);
		for (const statement of parsed) {
			rows += statement.rows.length;
			if (rows > MAX_ROWS_PER_DROP) throw new ParseRefusal('too_many_rows');
			statements.push(statement);
		}
	}
	return {files: documents.length, formats: [...formats], statements};
}

function parseDocument(bytes: Uint8Array): Document {
	if (isLegacyXls(bytes)) throw new ParseRefusal('legacy_xls_not_supported');
	if (isZip(bytes)) throw new ParseRefusal('unsupported_format');
	if (looksLikeCamt053(bytes)) return {format: 'camt053', statements: parseCamt053(bytes)};
	if (looksLikeRevolutCsv(bytes)) return {format: 'revolutCsv', statements: parseRevolutCsv(bytes)};
	if (looksLikeMt940(bytes)) return {format: 'mt940', statements: parseMt940(bytes)};
	if (looksLikeAbnAmroTxt(bytes)) return {format: 'abnAmroTxt', statements: parseAbnAmroTxt(bytes)};
	throw new ParseRefusal('unsupported_format');
}

function isLegacyXls(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= LEGACY_XLS_SIGNATURE.length &&
		LEGACY_XLS_SIGNATURE.equals(Buffer.from(bytes.buffer, bytes.byteOffset, LEGACY_XLS_SIGNATURE.length))
	);
}
