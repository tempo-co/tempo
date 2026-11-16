import {ParseRefusal} from './parse-result';

export type CsvDialect = {delimiter: string; quote: string};

/**
 * RFC 4180 records with the given delimiter and quote character: a quote opens a quoted field only at the start of
 * a field, and a doubled quote inside one is a quote; CRLF, LF or CR ends a record. Blank lines are skipped. With a
 * `limit`, reading stops after that many records. An unclosed quoted field at the end of the text is `parse_failed`.
 */
export function readCsv(text: string, {delimiter, quote}: CsvDialect, limit = Number.POSITIVE_INFINITY): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let quoted = false;
	for (let index = 0; index < text.length && records.length < limit; index++) {
		const character = text[index];
		if (quoted) {
			if (character !== quote) field += character;
			else if (text[index + 1] === quote) {
				field += quote;
				index++;
			} else quoted = false;
		} else if (character === quote && field === '') {
			quoted = true;
		} else if (character === delimiter) {
			record.push(field);
			field = '';
		} else if (character === '\n' || character === '\r') {
			if (character === '\r' && text[index + 1] === '\n') index++;
			record.push(field);
			if (record.length > 1 || record[0] !== '') records.push(record);
			record = [];
			field = '';
		} else {
			field += character;
		}
	}
	if (records.length >= limit) return records;
	if (quoted) throw new ParseRefusal('parse_failed');
	record.push(field);
	if (record.length > 1 || record[0] !== '') records.push(record);
	return records;
}
