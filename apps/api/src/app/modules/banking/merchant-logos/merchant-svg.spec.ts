import {performance} from 'node:perf_hooks';

import {isSvg} from './merchant-svg';

/** Comments whose closing and opening markers run together, as a crafted or broken icon may start. */
function chainedComments(count: number): string {
	return '<!--' + '--><!--'.repeat(count);
}

describe('isSvg', () => {
	it.each([
		['a bare svg element', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>'],
		['an svg element in upper case', '<SVG>'],
		['an svg element whose attributes start on the next line', '<svg\n\txmlns="http://www.w3.org/2000/svg"/>'],
		['a byte order mark and leading whitespace', '\uFEFF \n\t<svg></svg>'],
		['an xml declaration', '<?xml version="1.0" encoding="UTF-8"?>\n<svg></svg>'],
		['an xml declaration in upper case', '<?XML version="1.0"?><svg></svg>'],
		['comments before the svg element', '<!-- one -->\n<!-- two\n<svg> inside -->\n<svg></svg>'],
		[
			'comments around an svg doctype',
			'<?xml version="1.0"?>\n<!-- Generator: Example -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
				'"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- after -->\n<svg></svg>',
		],
		['an empty comment', '<!----><svg></svg>'],
		['many comments that run together', chainedComments(400) + '--><svg></svg>'],
	])('accepts %s', (_, text) => {
		expect(isSvg(Buffer.from(text))).toBe(true);
	});

	it.each([
		['an html page', Buffer.from('<!doctype html><html><head></head><body><svg></svg></body></html>')],
		['an html doctype before an svg element', Buffer.from('<!DOCTYPE html>\n<svg></svg>')],
		['an html page without a doctype', Buffer.from('<html><body>Not found</body></html>')],
		['raster bytes', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])],
		['an element whose name only starts with svg', Buffer.from('<svgfoo></svgfoo>')],
		['an svg element inside an unclosed comment', Buffer.from('<!-- note <svg></svg>')],
		['text after a comment', Buffer.from('<!-- note --> text --> <svg></svg>')],
		['an xml declaration without its closing ?>', Buffer.from('<?xml version="1.0"><svg></svg>')],
		['an svg doctype that never closes', Buffer.from('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"')],
		['two svg doctypes', Buffer.from('<!DOCTYPE svg><!DOCTYPE svg><svg></svg>')],
		['two xml declarations', Buffer.from('<?xml version="1.0"?><?xml version="1.0"?><svg></svg>')],
		['an svg element after the first 4096 bytes', Buffer.from(`<!--${' '.repeat(4096)}--><svg></svg>`)],
		['empty bytes', Buffer.alloc(0)],
	])('rejects %s', (_, bytes) => {
		expect(isSvg(bytes)).toBe(false);
	});

	it('answers within a few milliseconds for comments that run together without closing', () => {
		const bytes = Buffer.from(chainedComments(5000) + '<svg></svg>');
		const started = performance.now();
		expect(isSvg(bytes)).toBe(false);
		expect(performance.now() - started).toBeLessThan(50);
	});
});
