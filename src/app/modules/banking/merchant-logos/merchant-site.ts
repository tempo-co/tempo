import {DefaultTreeAdapterMap, parse} from 'parse5';
import sharp from 'sharp';

// Only raster buffers are decoded: no SVG or other vector, file or URL loaders.
sharp.block({operation: ['VipsForeignLoad']});
sharp.unblock({
	operation: [
		'VipsForeignLoadPngBuffer',
		'VipsForeignLoadJpegBuffer',
		'VipsForeignLoadWebpBuffer',
		'VipsForeignLoadNsgifBuffer',
	],
});

const MERCHANT_LOGO_SIZE = 128;
const MIN_ICON_SIZE = 32;
const MAX_INPUT_PIXELS = 4096 * 4096;
const MAX_SITE_NAME_LENGTH = 200;

export type SiteIcon = {url: string; size: number};
export type Homepage = {names: string[]; icons: SiteIcon[]; parked: boolean};

type Element = DefaultTreeAdapterMap['element'];

/** Reads the names a homepage gives itself and the raster icons it declares. */
export function parseHomepage(html: string, pageUrl: string): Homepage {
	const names: string[] = [];
	const icons: SiteIcon[] = [];
	let base = pageUrl;
	const elements: Element[] = [];
	const nodes: DefaultTreeAdapterMap['node'][] = [parse(html)];
	while (nodes.length) {
		const node = nodes.pop()!;
		if ('childNodes' in node) nodes.push(...[...node.childNodes].reverse());
		if ('tagName' in node) elements.push(node);
	}
	for (const element of elements) {
		const attributes = new Map(element.attrs.map(({name, value}) => [name.toLowerCase(), value.trim()]));
		if (element.tagName === 'base' && attributes.get('href'))
			base = resolveUrl(attributes.get('href')!, pageUrl) ?? base;
		if (element.tagName === 'title') names.push(textOf(element));
		if (element.tagName === 'meta') {
			const key = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase();
			if (['og:site_name', 'application-name', 'apple-mobile-web-app-title'].includes(key))
				names.push(attributes.get('content') ?? '');
		}
	}
	for (const element of elements) {
		if (element.tagName !== 'link') continue;
		const attributes = new Map(element.attrs.map(({name, value}) => [name.toLowerCase(), value.trim()]));
		const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
		const href = attributes.get('href');
		const type = (attributes.get('type') ?? '').toLowerCase();
		if (!href || type.includes('svg') || /\.svgz?(?:$|[?#])/i.test(href)) continue;
		const apple = rel.some((token) => token.startsWith('apple-touch-icon'));
		if (!apple && !rel.includes('icon')) continue;
		const url = resolveUrl(href, base);
		if (!url) continue;
		const declared = Math.max(
			0,
			...(attributes.get('sizes') ?? '')
				.split(/\s+/)
				.map((size) => Number(size.toLowerCase().split('x')[0]) || 0),
		);
		icons.push({url, size: declared || (apple ? 180 : 32)});
	}
	const cleanNames = [...new Set(names.map((name) => name.replace(/\s+/g, ' ').trim()).filter(Boolean))].map((name) =>
		name.slice(0, MAX_SITE_NAME_LENGTH),
	);
	const text = cleanNames.join(' ') + ' ' + html.slice(0, 64 * 1024).replace(/<[^>]*>/g, ' ');
	return {
		names: cleanNames.slice(0, 5),
		icons: [...new Map(icons.map((icon) => [icon.url, icon])).values()].sort((a, b) => b.size - a.size),
		parked: /\b(?:this domain (?:name )?(?:is|may be) for sale|buy this domain|domain (?:is )?parked|parked (?:free|domain))\b/i.test(
			text,
		),
	};
}

/** Icons to try, best first: declared icons by size, then the conventional paths most sites serve. */
export function iconCandidates(homepage: Homepage | null, origin: string): string[] {
	return [
		...new Set([
			...(homepage?.icons ?? []).map(({url}) => url),
			new URL('/apple-touch-icon.png', origin).href,
			new URL('/favicon.ico', origin).href,
		]),
	].slice(0, 6);
}

/**
 * Whether a site belongs to the brand the model named. When the site states its own names (title, og:site_name,
 * app name), one must spell the brand in whole words, spaces and punctuation aside: a model can name a plausible
 * domain that belongs to someone else. Only a site that states no name falls back to its hostname spelling the brand.
 */
export function siteMatchesBrand(brand: string, domain: string, siteNames: readonly string[]): boolean {
	const compact = tokens(brand).join('');
	if (!compact) return false;
	if (siteNames.length)
		return siteNames.some((name) => {
			const nameTokens = tokens(name);
			return nameTokens.some((_, start) => {
				let joined = '';
				for (const token of nameTokens.slice(start)) {
					joined += token;
					if (joined === compact) return true;
					if (!compact.startsWith(joined)) return false;
				}
				return false;
			});
		});
	return domain
		.split('.')
		.slice(0, -1)
		.some((label) => label.replace(/-/g, '') === compact);
}

/** Decodes one raster icon (PNG, JPEG, WebP, GIF, or a PNG or bitmap inside an ICO) to a square PNG on white. */
export async function encodeMerchantLogo(bytes: Buffer): Promise<Buffer> {
	const ico = largestIcoImage(bytes);
	const image =
		ico && 'rgba' in ico
			? sharp(ico.rgba, {raw: {width: ico.width, height: ico.height, channels: 4}})
			: sharp(ico?.encoded ?? bytes, {limitInputPixels: MAX_INPUT_PIXELS, pages: 1, failOn: 'error'});
	const {width = 0, height = 0, pages = 1} = await image.metadata();
	const size = Math.min(width, height);
	// Animated icons are skipped rather than reduced to a first frame that may not show the brand.
	if (pages > 1 || size < MIN_ICON_SIZE) throw new Error('Unusable icon.');
	const side = Math.min(MERCHANT_LOGO_SIZE, Math.max(width, height));
	return image
		.flatten({background: '#ffffff'})
		.resize(side, side, {fit: 'contain', background: '#ffffff'})
		.png({compressionLevel: 9})
		.toBuffer();
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type IcoImage = {encoded: Buffer} | {rgba: Buffer; width: number; height: number};

/** The largest readable image in an ICO container; null when the bytes are not an ICO. */
function largestIcoImage(bytes: Buffer): IcoImage | null {
	if (bytes.length < 6 || bytes.readUInt32LE(0) !== 0x00010000) return null;
	const count = bytes.readUInt16LE(4);
	if (count < 1 || count > 32 || 6 + count * 16 > bytes.length) throw new Error('Invalid icon.');
	let best: {image: IcoImage; size: number} | undefined;
	for (let index = 0; index < count; index++) {
		const entry = 6 + index * 16;
		const length = bytes.readUInt32LE(entry + 8);
		const offset = bytes.readUInt32LE(entry + 12);
		const size = bytes[entry] || 256;
		if (!length || offset + length > bytes.length || size <= (best?.size ?? 0)) continue;
		const data = bytes.subarray(offset, offset + length);
		const image = data.subarray(0, 8).equals(PNG_SIGNATURE) ? {encoded: data} : decodeIcoBitmap(data);
		if (image) best = {image, size};
	}
	if (!best) throw new Error('Unsupported icon.');
	return best.image;
}

/**
 * An uncompressed 24- or 32-bit ICO bitmap: a 40-byte header, bottom-up BGR(A) rows, then a 1-bit mask that marks
 * transparent pixels. The mask applies to 24-bit images and to 32-bit images whose alpha channel is empty.
 */
function decodeIcoBitmap(data: Buffer): {rgba: Buffer; width: number; height: number} | null {
	if (data.length < 40 || data.readUInt32LE(0) !== 40) return null;
	const width = data.readInt32LE(4);
	const height = data.readInt32LE(8) / 2;
	const bits = data.readUInt16LE(14);
	if (!Number.isInteger(height) || width < 1 || width > 256 || height < 1 || height > 256) return null;
	if ((bits !== 24 && bits !== 32) || data.readUInt32LE(16) !== 0) return null;
	const stride = Math.ceil((width * bits) / 32) * 4;
	const maskStride = Math.ceil(width / 32) * 4;
	const maskStart = 40 + stride * height;
	if (data.length < maskStart) return null;
	const hasMask = data.length >= maskStart + maskStride * height;
	const rgba = Buffer.alloc(width * height * 4);
	let hasAlpha = false;
	for (let y = 0; y < height; y++) {
		const row = 40 + (height - 1 - y) * stride;
		for (let x = 0; x < width; x++) {
			const source = row + x * (bits / 8);
			const target = (y * width + x) * 4;
			rgba[target] = data[source + 2];
			rgba[target + 1] = data[source + 1];
			rgba[target + 2] = data[source];
			rgba[target + 3] = bits === 32 ? data[source + 3] : 255;
			hasAlpha ||= bits === 32 && data[source + 3] > 0;
		}
	}
	if (hasMask && !hasAlpha)
		for (let y = 0; y < height; y++) {
			const row = maskStart + (height - 1 - y) * maskStride;
			for (let x = 0; x < width; x++)
				rgba[(y * width + x) * 4 + 3] = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
		}
	return {rgba, width, height};
}

function tokens(value: string): string[] {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

function textOf(element: Element): string {
	return element.childNodes.map((node) => ('value' in node ? node.value : '')).join('');
}

function resolveUrl(href: string, base: string): string | null {
	try {
		const url = new URL(href, base);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}
