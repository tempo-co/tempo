import {DefaultTreeAdapterMap, parse} from 'parse5';
import sharp from 'sharp';

import {SVG_RENDER_SIZE, isSvg, rasterizeSvg} from './merchant-svg';

// Only raster buffers are decoded in this process: SVG is rendered in a separate one (merchant-svg.ts), and no file
// or URL loaders are available.
sharp.block({operation: ['VipsForeignLoad']});
sharp.unblock({
	operation: [
		'VipsForeignLoadPngBuffer',
		'VipsForeignLoadJpegBuffer',
		'VipsForeignLoadWebpBuffer',
		'VipsForeignLoadNsgifBuffer',
	],
});

/** The stored logo's side in pixels; a source at least this large looks sharp in every tile. */
export const MERCHANT_LOGO_SIZE = 128;
export const MIN_ICON_SIZE = 32;
const MAX_INPUT_PIXELS = 4096 * 4096;
const MAX_SITE_NAME_LENGTH = 200;
const MAX_ICON_CANDIDATES = 10;
/** Assumed sizes for icons that declare none: an apple-touch-icon is made for home screens, a favicon for tabs. */
const APPLE_TOUCH_ICON_SIZE = 180;
const FAVICON_SIZE = 32;

/** A declared icon and its size in pixels; a vector icon counts as SVG_RENDER_SIZE. */
export type SiteIcon = {url: string; size: number};
export type Homepage = {names: string[]; icons: SiteIcon[]; manifest: string | null; parked: boolean};
/** A logo ready to store, with the size of the image it came from. */
export type MerchantLogoImage = {png: Buffer; size: number};

type Element = DefaultTreeAdapterMap['element'];

/** Reads the names a homepage gives itself, the icons it declares and its web app manifest. */
export function parseHomepage(html: string, pageUrl: string): Homepage {
	const names: string[] = [];
	const icons: SiteIcon[] = [];
	let manifest: string | null = null;
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
		const url = href ? resolveUrl(href, base) : null;
		if (!url) continue;
		if (rel.includes('manifest')) {
			manifest ??= url;
			continue;
		}
		const apple = rel.some((token) => token.startsWith('apple-touch-icon'));
		if (!apple && !rel.includes('icon')) continue;
		const declared = largestDeclaredSize(attributes.get('sizes'));
		icons.push({
			url,
			size: isVectorIcon(attributes.get('type'), url)
				? SVG_RENDER_SIZE
				: declared || (apple ? APPLE_TOUCH_ICON_SIZE : FAVICON_SIZE),
		});
	}
	const cleanNames = [...new Set(names.map((name) => name.replace(/\s+/g, ' ').trim()).filter(Boolean))].map((name) =>
		name.slice(0, MAX_SITE_NAME_LENGTH),
	);
	const text = cleanNames.join(' ') + ' ' + html.slice(0, 64 * 1024).replace(/<[^>]*>/g, ' ');
	return {
		names: cleanNames.slice(0, 5),
		icons: [...new Map(icons.map((icon) => [icon.url, icon])).values()],
		manifest,
		parked: /\b(?:this domain (?:name )?(?:is|may be) for sale|buy this domain|domain (?:is )?parked|parked (?:free|domain))\b/i.test(
			text,
		),
	};
}

/** The icons a web app manifest lists, except monochrome ones, which are meant to be tinted. */
export function parseManifestIcons(json: string, manifestUrl: string): SiteIcon[] {
	let manifest: unknown;
	try {
		manifest = JSON.parse(json);
	} catch {
		return [];
	}
	const icons = (manifest as {icons?: unknown} | null)?.icons;
	if (!Array.isArray(icons)) return [];
	return icons.flatMap((icon: unknown) => {
		if (!icon || typeof icon !== 'object') return [];
		const {src, sizes, type, purpose} = icon as Record<string, unknown>;
		if (typeof src !== 'string') return [];
		if (typeof purpose === 'string' && purpose.split(/\s+/).every((value) => value === 'monochrome')) return [];
		const url = resolveUrl(src, manifestUrl);
		if (!url) return [];
		const declared = largestDeclaredSize(typeof sizes === 'string' ? sizes : undefined);
		return [
			{
				url,
				size: isVectorIcon(typeof type === 'string' ? type : undefined, url)
					? SVG_RENDER_SIZE
					: declared || FAVICON_SIZE,
			},
		];
	});
}

/**
 * Icons to try: the page's own icons, then its web app manifest's, each largest first (vector first, equal sizes in
 * page order), then the conventional paths most sites serve, which also work when the homepage refuses us. Manifest
 * icons come after the page's because an app's install icon is more often a framework placeholder than the brand
 * mark. Plain-http icon links are tried over HTTPS.
 */
export function iconCandidates(
	homepage: Homepage | null,
	origin: string,
	manifestIcons: readonly SiteIcon[] = [],
): string[] {
	const bySize = (icons: readonly SiteIcon[]) => [...icons].sort((a, b) => b.size - a.size).map(({url}) => url);
	return [
		...new Set(
			[
				...bySize(homepage?.icons ?? []),
				...bySize(manifestIcons),
				...['/favicon.svg', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.ico'].map(
					(path) => new URL(path, origin).href,
				),
			].map((url) => url.replace(/^http:\/\//i, 'https://')),
		),
	].slice(0, MAX_ICON_CANDIDATES);
}

/** A content system's stand-in icon, served when a site has none of its own, such as WordPress's "W". */
export function isPlatformDefaultIcon(url: string): boolean {
	return /\/wp-includes\/images\//i.test(new URL(url).pathname);
}

/**
 * Whether a site belongs to the brand the model named. When the site states its own names (title, og:site_name,
 * app name), one must spell the brand in whole words, spaces and punctuation aside, allowing a plural or possessive
 * "s": a model can name a plausible domain that belongs to someone else. Only a site that states no name falls back
 * to its hostname: one label spells the brand, or every word of the brand is a label (`play.example.com` for
 * "Example Play").
 */
export function siteMatchesBrand(brand: string, domain: string, siteNames: readonly string[]): boolean {
	const brandTokens = tokens(brand);
	const compact = brandTokens.join('');
	if (!compact) return false;
	// The plural or possessive variant only for longer brands: "Bar" and "Bars" may well be different businesses.
	const spellings =
		compact.length >= 6 ? [compact, compact.endsWith('s') ? compact.slice(0, -1) : `${compact}s`] : [compact];
	if (siteNames.length)
		return siteNames.some((name) => {
			const nameTokens = tokens(name);
			return nameTokens.some((_, start) => {
				let joined = '';
				for (const token of nameTokens.slice(start)) {
					joined += token;
					if (spellings.includes(joined)) return true;
					if (!spellings.some((spelling) => spelling.startsWith(joined))) return false;
				}
				return false;
			});
		});
	const labels = domain.split('.').slice(0, -1);
	return (
		labels.some((label) => label.replace(/-/g, '') === compact) ||
		(brandTokens.length > 1 && brandTokens.every((token) => labels.includes(token)))
	);
}

/**
 * Decodes one icon to a square PNG on white, with the source's size in pixels: SVG (rendered), PNG, JPEG, WebP, GIF,
 * or a PNG or bitmap inside an ICO. Rejects icons too small to show, animations and icons that come out blank.
 */
export async function encodeMerchantLogo(bytes: Buffer): Promise<MerchantLogoImage> {
	const svg = isSvg(bytes);
	const ico = svg ? null : largestIcoImage(bytes);
	const image =
		ico && 'rgba' in ico
			? sharp(ico.rgba, {raw: {width: ico.width, height: ico.height, channels: 4}})
			: sharp(svg ? await rasterizeSvg(bytes) : (ico?.encoded ?? bytes), {
					limitInputPixels: MAX_INPUT_PIXELS,
					pages: 1,
					failOn: 'error',
				});
	const {width = 0, height = 0, pages = 1} = await image.metadata();
	const size = svg ? SVG_RENDER_SIZE : Math.min(width, height);
	// Animated icons are skipped rather than reduced to a first frame that may not show the brand.
	if (pages > 1 || Math.min(width, height) < MIN_ICON_SIZE) throw new Error('Unusable icon.');
	const side = Math.min(MERCHANT_LOGO_SIZE, Math.max(width, height));
	const png = await image
		.flatten({background: '#ffffff'})
		.resize(side, side, {fit: 'contain', background: '#ffffff'})
		.png({compressionLevel: 9})
		.toBuffer();
	// A white mark on a transparent background, drawn for dark browser tabs, comes out as an empty white square.
	const {channels} = await sharp(png).stats();
	if (channels.every(({mean, stdev}) => mean > 250 && stdev < 1)) throw new Error('Blank icon.');
	return {png, size};
}

/** A merchant as the read path sees it, for choosing the logo it shows. */
export type MerchantLogoCandidate = {
	key: string;
	brand: string | null;
	domain: string | null;
	domainConfident: boolean;
	logo: {
		id: string;
		status: string;
		version: string | null;
		siteNames: string[];
		homepageLoaded: boolean;
		sourceSize: number | null;
	} | null;
};

/**
 * The logo each merchant key shows. A merchant's own logo counts when its site's homepage confirmed the brand, or,
 * for a site whose homepage would not load, when the model was sure of the domain. Merchants of one brand show the
 * same logo, the largest any of them has, so a chain's country sites look alike and a branch without a site of its
 * own still shows its brand.
 */
export function chooseMerchantLogos(
	merchants: readonly MerchantLogoCandidate[],
): Map<string, {id: string; version: string}> {
	const trusted = ({brand, domain, domainConfident, logo}: MerchantLogoCandidate) =>
		!!brand &&
		!!domain &&
		logo?.status === 'READY' &&
		!!logo.version &&
		(logo.homepageLoaded ? siteMatchesBrand(brand, domain, logo.siteNames) : domainConfident);
	const sizeOf = (merchant: MerchantLogoCandidate | undefined) => merchant?.logo?.sourceSize ?? 0;
	const best = new Map<string, MerchantLogoCandidate>();
	for (const merchant of merchants) {
		if (!trusted(merchant)) continue;
		const brand = tokens(merchant.brand!).join('');
		if (sizeOf(merchant) > sizeOf(best.get(brand)) || !best.has(brand)) best.set(brand, merchant);
	}
	const chosen = new Map<string, {id: string; version: string}>();
	for (const merchant of merchants) {
		if (!merchant.brand) continue;
		const brandBest = best.get(tokens(merchant.brand).join(''));
		if (!brandBest) continue;
		// On a tie the merchant keeps its own site's logo.
		const {logo} = trusted(merchant) && sizeOf(merchant) >= sizeOf(brandBest) ? merchant : brandBest;
		chosen.set(merchant.key, {id: logo!.id, version: logo!.version!});
	}
	return chosen;
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
 * An uncompressed ICO bitmap: a 40-byte header, a colour table for 1-, 4- and 8-bit images, bottom-up rows of
 * palette indexes or BGR(A) pixels, then a 1-bit mask that marks transparent pixels. The mask applies unless a
 * 32-bit image carries its own alpha.
 */
function decodeIcoBitmap(data: Buffer): {rgba: Buffer; width: number; height: number} | null {
	if (data.length < 40 || data.readUInt32LE(0) !== 40) return null;
	const width = data.readInt32LE(4);
	const height = data.readInt32LE(8) / 2;
	const bits = data.readUInt16LE(14);
	if (!Number.isInteger(height) || width < 1 || width > 256 || height < 1 || height > 256) return null;
	if (![1, 4, 8, 24, 32].includes(bits) || data.readUInt32LE(16) !== 0) return null;
	const colours = bits <= 8 ? data.readUInt32LE(32) || 2 ** bits : 0;
	if (colours > 2 ** bits) return null;
	const pixelStart = 40 + colours * 4;
	const stride = Math.ceil((width * bits) / 32) * 4;
	const maskStride = Math.ceil(width / 32) * 4;
	const maskStart = pixelStart + stride * height;
	if (data.length < maskStart) return null;
	const hasMask = data.length >= maskStart + maskStride * height;
	const rgba = Buffer.alloc(width * height * 4);
	let hasAlpha = false;
	for (let y = 0; y < height; y++) {
		const row = pixelStart + (height - 1 - y) * stride;
		for (let x = 0; x < width; x++) {
			const target = (y * width + x) * 4;
			let source = row + x * (bits / 8);
			if (bits <= 8) {
				const bit = x * bits;
				const index = (data[row + (bit >> 3)] >> (8 - bits - (bit & 7))) & (2 ** bits - 1);
				if (index >= colours) return null;
				source = 40 + index * 4;
			}
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

function isVectorIcon(type: string | undefined, url: string): boolean {
	return (type ?? '').toLowerCase().includes('svg') || /\.svgz?(?:$|[?#])/i.test(url);
}

function largestDeclaredSize(sizes: string | undefined): number {
	return Math.max(0, ...(sizes ?? '').split(/\s+/).map((size) => Number(size.toLowerCase().split('x')[0]) || 0));
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
