import sharp from 'sharp';

// Installs the same raster-only sharp loader policy used for merchant images.
import '../merchant-logos/merchant-site';
import {isSvg, rasterizeSvg} from '../merchant-logos/merchant-svg';

export const BANK_LOGO_VERSION = 'colour-v1';
export type LogoTheme = 'light' | 'dark';
export type ConvertedBankLogo = {
	light: Buffer;
	dark: Buffer;
	plates: Record<LogoTheme, boolean>;
	displayVariants: Record<LogoTheme, LogoTheme>;
};

/** Rounded sRGB values of Tempo's card and canvas tokens. Pixel-affecting changes require a new version. */
const SURFACES = {
	light: [
		[251, 248, 241],
		[246, 241, 232],
	],
	dark: [
		[32, 30, 36],
		[23, 22, 27],
	],
};
const CONTRAST_THRESHOLD = 3;

/** Original-colour converter: edge-connected matte removal, neutral-ink lift, then contrast-based plates. */
export async function convertBankLogo(original: Buffer): Promise<ConvertedBankLogo> {
	const input = isSvg(original) ? await rasterizeSvg(original) : original;
	const image = sharp(input, {limitInputPixels: 4096 * 4096, failOn: 'error'}).timeout({seconds: 5});
	const metadata = await image.metadata();
	if ((metadata.pages ?? 1) > 1) throw new Error('Animated bank logo.');
	const {data: light, info} = await image
		.autoOrient()
		.resize(896, 288, {fit: 'inside', withoutEnlargement: true})
		.ensureAlpha()
		.raw()
		.toBuffer({resolveWithObject: true});
	const removed = removeEdgeBackground(light, info.width, info.height);
	if (!light.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('Empty bank logo.');
	const dark = Buffer.from(light);
	let changed = 0;
	let opaque = 0;
	let retainedWhite = 0;
	for (let i = 0; i < light.length; i += 4) {
		const rgb = [light[i], light[i + 1], light[i + 2]];
		const max = Math.max(...rgb);
		const min = Math.min(...rgb);
		if (light[i + 3] >= 200) {
			opaque++;
			if (min >= 235) retainedWhite++;
		}
		if (
			light[i + 3] &&
			(max - min) / Math.max(max, 1) <= 0.12 &&
			max - min <= 18 &&
			(rgb[0] + rgb[1] + rgb[2]) / 3 <= 145
		) {
			for (let c = 0; c < 3; c++) dark[i + c] = roundEven(246 - rgb[c] * 0.15);
			if (light[i + 3] >= 200) changed++;
		}
	}
	const raw = {width: info.width, height: info.height, channels: 4 as const};
	const [lightPng, darkPng] = await Promise.all([
		sharp(light, {raw}).png().toBuffer(),
		sharp(dark, {raw}).png().toBuffer(),
	]);
	const backingGuard =
		retainedWhite > 0.02 * Math.max(1, opaque) && (changed > 0.01 * Math.max(1, opaque) || removed > 0);
	const plates = {light: false, dark: false};
	for (const theme of ['light', 'dark'] as const) {
		const sample = await sharp(theme === 'light' ? lightPng : darkPng)
			.resize(112, 36, {fit: 'inside', withoutEnlargement: true})
			.raw()
			.toBuffer();
		plates[theme] =
			SURFACES[theme].some((surface) => contrastP10(sample, surface) < CONTRAST_THRESHOLD) ||
			(theme === 'dark' && backingGuard);
	}
	return {
		light: lightPng,
		dark: darkPng,
		plates,
		displayVariants: {light: 'light', dark: plates.dark ? 'light' : 'dark'},
	};
}

function removeEdgeBackground(data: Buffer, width: number, height: number): number {
	const candidate = (pixel: number) => {
		const i = pixel * 4;
		const min = Math.min(data[i], data[i + 1], data[i + 2]);
		return min >= 235 && Math.max(data[i], data[i + 1], data[i + 2]) - min <= 18 && data[i + 3] >= 245;
	};
	const corners = [0, width - 1, (height - 1) * width, width * height - 1];
	if (corners.filter(candidate).length < 3) return 0;
	const boundary: number[] = [];
	for (let x = 0; x < width; x++) {
		boundary.push(x);
		if (height > 1) boundary.push((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y++) {
		boundary.push(y * width);
		if (width > 1) boundary.push(y * width + width - 1);
	}
	if (boundary.filter(candidate).length / boundary.length < 0.65) return 0;
	const seen = new Uint8Array(width * height);
	const queue = new Int32Array(width * height);
	let end = 0;
	const visit = (pixel: number) => {
		if (!seen[pixel] && candidate(pixel)) {
			seen[pixel] = 1;
			queue[end++] = pixel;
		}
	};
	boundary.forEach(visit);
	for (let start = 0; start < end; start++) {
		const pixel = queue[start];
		if (pixel % width) visit(pixel - 1);
		if (pixel % width < width - 1) visit(pixel + 1);
		if (pixel >= width) visit(pixel - width);
		if (pixel < width * (height - 1)) visit(pixel + width);
	}
	for (let i = 0; i < end; i++) data[queue[i] * 4 + 3] = 0;
	return end;
}

function luminance(rgb: number[]): number {
	return rgb.reduce((sum, value, channel) => {
		const s = value / 255;
		return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][channel];
	}, 0);
}

function contrastP10(data: Buffer, background: number[]): number {
	const back = luminance(background);
	const contrasts: number[] = [];
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 180) continue;
		const alpha = data[i + 3] / 255;
		const lum = luminance(background.map((value, c) => data[i + c] * alpha + value * (1 - alpha)));
		contrasts.push((Math.max(lum, back) + 0.05) / (Math.min(lum, back) + 0.05));
	}
	if (!contrasts.length) return 1;
	contrasts.sort((a, b) => a - b);
	const index = (contrasts.length - 1) * 0.1;
	const low = Math.floor(index);
	const value = contrasts[low] + (contrasts[Math.ceil(index)] - contrasts[low]) * (index - low);
	return Math.round(value * 1000) / 1000;
}

function roundEven(value: number): number {
	const floor = Math.floor(value);
	return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}
