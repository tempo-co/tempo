import {looksLikeAbnAmroTxt, parseAbnAmroTxt} from './abn-amro-txt';
import {looksLikeCamt053, parseCamt053} from './camt053';
import {CsvLayout} from './csv-layout';
import {readCsvLayout} from './csv-layout-reader';
import {looksLikeMt940, parseMt940} from './mt940';
import {looksLikeOfx, parseOfx} from './ofx';
import {MAX_ROWS_PER_DROP} from './parse-limits';
import {NormalizedStatement, ParseRefusal, ParseResult, StatementFormat} from './parse-result';
import {looksLikeRevolutCsv, parseRevolutCsv, parseRevolutXlsx} from './revolut';
import {sampleTable} from './table-sample';
import {isXlsx} from './xlsx';
import {isZip, readZipEntries} from './zip-reader';

/** The signature of the old binary Office file (OLE2 compound document) that `.xls` workbooks are. */
const LEGACY_XLS_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** One file's statements; `layout` is the bank CSV layout it was read with, if any. */
type Document = {format: StatementFormat; layout?: string; statements: NormalizedStatement[]};

/**
 * Decides the format from the content alone (never the name) and parses one uploaded file. A workbook is read as
 * a Revolut statement, or else with the owner's saved layouts. Any other zip is unpacked one level: every entry must
 * itself be a supported statement file, in any mix of formats, and an archive or workbook inside the archive is
 * refused.
 *
 * `owned` are the owner's saved layouts, newest first: tried after every built-in reader and layout. A file none of
 * them reads that still reads as a table is refused with `layout_unknown`, so its columns can be worked out.
 */
export function parseFile(bytes: Uint8Array, owned: readonly CsvLayout[] = []): ParseResult {
	if (isZip(bytes) && isXlsx(bytes)) return collect([bytes], () => parseWorkbook(bytes, owned));
	if (!isZip(bytes)) return collect([bytes], (document) => parseDocument(document, owned));
	const documents = readZipEntries(bytes).map(({content}) => content);
	if (documents.length === 0) throw new ParseRefusal('unsupported_format');
	// The columns of a table inside an archive are not worked out: it is a format Tempo does not read.
	return collect(documents, (document) => {
		try {
			return parseDocument(document, owned);
		} catch (error) {
			if (error instanceof ParseRefusal && error.code === 'layout_unknown') {
				throw new ParseRefusal('unsupported_format');
			}
			throw error;
		}
	});
}

function collect(documents: readonly Uint8Array[], parse: (document: Uint8Array) => Document): ParseResult {
	const formats = new Set<StatementFormat>();
	const layouts = new Set<string>();
	const statements: NormalizedStatement[] = [];
	let rows = 0;
	for (const document of documents) {
		const {format, layout, statements: parsed} = parse(document);
		formats.add(format);
		if (layout) layouts.add(layout);
		for (const statement of parsed) {
			rows += statement.rows.length;
			if (rows > MAX_ROWS_PER_DROP) throw new ParseRefusal('too_many_rows');
			statements.push(statement);
		}
	}
	return {files: documents.length, formats: [...formats], layouts: [...layouts], statements};
}

function parseWorkbook(bytes: Uint8Array, owned: readonly CsvLayout[]): Document {
	try {
		return {format: 'revolutXlsx', statements: parseRevolutXlsx(bytes)};
	} catch (error) {
		// Only a workbook laid out another way goes on; a Revolut statement that does not read stays refused.
		if (!(error instanceof ParseRefusal && error.code === 'unsupported_format')) throw error;
	}
	return readOwned(bytes, owned, null);
}

function parseDocument(bytes: Uint8Array, owned: readonly CsvLayout[]): Document {
	if (isLegacyXls(bytes)) throw new ParseRefusal('legacy_xls_not_supported');
	if (isZip(bytes)) throw new ParseRefusal('unsupported_format');
	if (looksLikeCamt053(bytes)) return {format: 'camt053', statements: parseCamt053(bytes)};
	if (looksLikeRevolutCsv(bytes)) return {format: 'revolutCsv', statements: parseRevolutCsv(bytes)};
	if (looksLikeMt940(bytes)) return {format: 'mt940', statements: parseMt940(bytes)};
	if (looksLikeAbnAmroTxt(bytes)) return {format: 'abnAmroTxt', statements: parseAbnAmroTxt(bytes)};
	if (looksLikeOfx(bytes)) return {format: 'ofx', statements: parseOfx(bytes)};
	let nearMiss: ParseRefusal | null = null;
	try {
		const csv = readCsvLayout(bytes);
		if (csv) return {format: 'csv', layout: csv.layout.id, statements: csv.statements};
	} catch (error) {
		// A near miss of a built-in layout may still be a layout the owner saved for it.
		if (!(error instanceof ParseRefusal && error.code === 'layout_not_recognized')) throw error;
		nearMiss = error;
	}
	return readOwned(bytes, owned, nearMiss);
}

/** Reads a file with the owner's layouts; a built-in near miss wins over theirs when none reads it. */
function readOwned(bytes: Uint8Array, owned: readonly CsvLayout[], nearMiss: ParseRefusal | null): Document {
	let read: ReturnType<typeof readCsvLayout> = null;
	try {
		read = owned.length > 0 ? readCsvLayout(bytes, owned, {owned: true}) : null;
	} catch (error) {
		if (!(error instanceof ParseRefusal && error.code === 'layout_not_recognized')) throw error;
		nearMiss ??= error;
	}
	if (read) return {format: 'csv', layout: read.layout.id, statements: read.statements};
	if (nearMiss) throw nearMiss;
	throw new ParseRefusal(sampleTable(bytes) ? 'layout_unknown' : 'unsupported_format');
}

function isLegacyXls(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= LEGACY_XLS_SIGNATURE.length &&
		LEGACY_XLS_SIGNATURE.equals(Buffer.from(bytes.buffer, bytes.byteOffset, LEGACY_XLS_SIGNATURE.length))
	);
}
