import {DOMParser, type Element} from '@xmldom/xmldom';

import {ParseRefusal} from './parse-result';

/**
 * The root element of an XML document from an uploaded file. Documents declaring a DTD or entities are refused
 * before parsing, and the parser never expands custom entities or fetches anything; any markup error is
 * `parse_failed`.
 */
export function parseXml(xml: string): Element | null {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ParseRefusal('parse_failed');
	try {
		return new DOMParser({
			onError: (level) => {
				if (level !== 'warning') throw new ParseRefusal('parse_failed');
			},
		}).parseFromString(xml, 'text/xml').documentElement;
	} catch {
		throw new ParseRefusal('parse_failed');
	}
}

export function children(parent: Element | null, name: string): Element[] {
	const found: Element[] = [];
	if (!parent) return found;
	for (let node = parent.firstChild; node; node = node.nextSibling) {
		if (node.nodeType === node.ELEMENT_NODE && (node as Element).localName === name) found.push(node as Element);
	}
	return found;
}

export function child(parent: Element | null, name: string): Element | null {
	return children(parent, name)[0] ?? null;
}
