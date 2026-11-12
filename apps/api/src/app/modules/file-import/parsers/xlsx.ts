import {type Element} from '@xmldom/xmldom';

import {MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_UNPACKED_BYTES} from './parse-limits';
import {ParseRefusal} from './parse-result';
import {child, children, parseXml} from './xml';
import {readZipEntries, zipEntryNames} from './zip-reader';

const WORKBOOK = 'xl/workbook.xml';
const WORKBOOK_RELATIONSHIPS = 'xl/_rels/workbook.xml.rels';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHARED_STRINGS_TYPE = `${RELATIONSHIPS_NAMESPACE}/sharedStrings`;
const CELL_REFERENCE = /^([A-Z]{1,3})\d+$/;

/** A cell value: the text of a string cell, or the number of a numeric cell as written. */
export type XlsxCell = {type: 'string' | 'number'; value: string};

/** A zip whose entries include the workbook part of a spreadsheet. */
export function isXlsx(bytes: Uint8Array): boolean {
	return zipEntryNames(bytes).includes(WORKBOOK);
}

/**
 * The cell values of the workbook's first sheet, row by row (empty rows left out, missing cells null). Only the
 * workbook, its relationships, that sheet and the shared strings are unpacked, within the archive limits. Formulas
 * are never read: a sheet holding one is refused, so only values the file states are imported.
 */
export function readFirstSheet(bytes: Uint8Array): (XlsxCell | null)[][] {
	let budget = MAX_ARCHIVE_UNPACKED_BYTES;
	const read = (names: readonly string[]) => {
		const entries = readZipEntries(bytes, {maxEntries: MAX_ARCHIVE_ENTRIES, maxUnpackedBytes: budget}, (name) =>
			names.includes(name),
		);
		budget -= entries.reduce((total, {content}) => total + content.length, 0);
		return new Map(entries.map(({name, content}) => [name, readPart(content)]));
	};

	const parts = read([WORKBOOK, WORKBOOK_RELATIONSHIPS]);
	const workbook = parts.get(WORKBOOK);
	const relationships = parts.get(WORKBOOK_RELATIONSHIPS);
	if (!workbook || !relationships) throw new ParseRefusal('parse_failed');
	const sheet = descendants(workbook, 'sheet')[0];
	const sheetId = sheet && attributeIn(sheet, RELATIONSHIPS_NAMESPACE, 'id');
	const targets = descendants(relationships, 'Relationship');
	const sheetPath = partPath(targets.find((target) => target.getAttribute('Id') === sheetId));
	const stringsTarget = targets.find((target) => target.getAttribute('Type') === SHARED_STRINGS_TYPE);
	const stringsPath = stringsTarget ? partPath(stringsTarget) : null;
	if (!sheetPath) throw new ParseRefusal('parse_failed');

	const content = read(stringsPath ? [sheetPath, stringsPath] : [sheetPath]);
	const worksheet = content.get(sheetPath);
	if (!worksheet) throw new ParseRefusal('parse_failed');
	const sharedStrings = stringsPath ? readSharedStrings(content.get(stringsPath)) : [];
	return readRows(worksheet, sharedStrings);
}

function readRows(worksheet: Element, sharedStrings: readonly string[]): (XlsxCell | null)[][] {
	const rows: (XlsxCell | null)[][] = [];
	for (const row of children(child(worksheet, 'sheetData'), 'row')) {
		const cells: (XlsxCell | null)[] = [];
		for (const cell of children(row, 'c')) {
			if (child(cell, 'f')) throw new ParseRefusal('parse_failed');
			const reference = CELL_REFERENCE.exec(cell.getAttribute('r') ?? '');
			const column = reference ? columnIndex(reference[1]) : cells.length;
			if (column < cells.length) throw new ParseRefusal('parse_failed');
			while (cells.length < column) cells.push(null);
			cells.push(cellValue(cell, sharedStrings));
		}
		if (cells.some((cell) => cell !== null)) rows.push(cells);
	}
	return rows;
}

function cellValue(cell: Element, sharedStrings: readonly string[]): XlsxCell | null {
	const type = cell.getAttribute('t') || 'n';
	if (type === 'inlineStr') return {type: 'string', value: richText(child(cell, 'is'))};
	const value = child(cell, 'v')?.textContent ?? null;
	if (value === null || value === '') return null;
	if (type === 's') {
		const text = /^\d+$/.test(value) ? sharedStrings[Number(value)] : undefined;
		if (text === undefined) throw new ParseRefusal('parse_failed');
		return {type: 'string', value: text};
	}
	if (type === 'str') return {type: 'string', value};
	if (type === 'n') return {type: 'number', value};
	// Booleans, errors and ISO dates never appear in a statement export.
	throw new ParseRefusal('parse_failed');
}

function readSharedStrings(table: Element | undefined): string[] {
	if (!table) throw new ParseRefusal('parse_failed');
	return children(table, 'si').map(richText);
}

/** The text of a string item: its own `t`, or the `t` of each run; phonetic hints are left out. */
function richText(item: Element | null): string {
	const own = child(item, 't');
	if (own) return own.textContent ?? '';
	return children(item, 'r')
		.map((run) => child(run, 't')?.textContent ?? '')
		.join('');
}

/** A relationship's target as a zip entry name; targets are relative to `xl/` unless absolute. */
function partPath(relationship: Element | undefined): string | null {
	const target = relationship?.getAttribute('Target');
	if (!target) return null;
	const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
	return path.split('/').some((segment) => segment === '..' || segment === '.') ? null : path;
}

function columnIndex(letters: string): number {
	let index = 0;
	for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
	return index - 1;
}

/** A workbook part's root element; parts are UTF-8 XML. */
function readPart(content: Buffer): Element {
	let xml: string;
	try {
		xml = new TextDecoder('utf-8', {fatal: true}).decode(content);
	} catch {
		throw new ParseRefusal('parse_failed');
	}
	const root = parseXml(xml);
	if (!root) throw new ParseRefusal('parse_failed');
	return root;
}

function attributeIn(element: Element, namespace: string, name: string): string | null {
	for (let index = 0; index < element.attributes.length; index++) {
		const attribute = element.attributes.item(index)!;
		if (attribute.namespaceURI === namespace && attribute.localName === name) return attribute.value;
	}
	return null;
}

function descendants(root: Element, name: string): Element[] {
	return Array.from(root.getElementsByTagNameNS('*', name));
}
