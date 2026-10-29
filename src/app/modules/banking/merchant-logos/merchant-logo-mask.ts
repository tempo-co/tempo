import sharp, {OutputInfo} from 'sharp';

import {resizeMask} from './mask-resample';

export const MERCHANT_LOGO_MASK_VERSION = 'mask-v1';
const SIZE = 128;
const MARK_SIZE = 104;
type Colour = [number, number, number];
const clip = (value: number) => Math.max(0, Math.min(255, value));

/** NumPy rint / Python round use ties-to-even, unlike Math.round. */
function roundEven(value: number): number {
	const floor = Math.floor(value);
	return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}

function median(values: number[]): number {
	values.sort((a, b) => a - b);
	const middle = Math.floor(values.length / 2);
	return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function fieldMedian(rgb: Buffer, indices: number[]): Colour {
	return [0, 1, 2].map((channel) => median(indices.map((i) => rgb[i * 3 + channel] / 255))) as Colour;
}

function distance(rgb: Buffer, index: number, field: Colour): number {
	const offset = index * 3;
	return Math.max(
		Math.abs(rgb[offset] / 255 - field[0]),
		Math.abs(rgb[offset + 1] / 255 - field[1]),
		Math.abs(rgb[offset + 2] / 255 - field[2]),
	);
}

/** Translated AOSP QPR2 RGB-average alpha, range expansion and contrast pass (not the bitmap adapter). */
function aospAlpha(rgb: Buffer): Float64Array {
	const alpha = new Float64Array(rgb.length / 3);
	let low = 255;
	let high = 0;
	for (let i = 0; i < alpha.length; i++) {
		alpha[i] = clip(Math.floor((rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) * 0.3333 + 0.5));
		low = Math.min(low, alpha[i]);
		high = Math.max(high, alpha[i]);
	}
	if (low < high) {
		for (let i = 0; i < alpha.length; i++) {
			const pixel = Math.floor(((alpha[i] - low) * 255) / (high - low) + 0.5);
			alpha[i] = clip(
				pixel > 128
					? 255 - Math.floor(((256 - pixel) / 128) * (255 - pixel))
					: Math.floor((pixel * pixel) / 128),
			);
		}
	}
	return alpha;
}

/** Continuous minimum coverage over a known flat field, suppressing ill-conditioned gamut directions. */
function matteFor(rgb: Buffer, field: Colour): Float64Array {
	const matte = new Float64Array(rgb.length / 3);
	for (let i = 0; i < matte.length; i++) {
		let coverage = 0;
		for (let c = 0; c < 3; c++) {
			const difference = rgb[i * 3 + c] / 255 - field[c];
			const positive = 1 - field[c] < 4 / 255 ? 0 : Math.max(difference, 0) / Math.max(1 - field[c], 1 / 255);
			const negative = field[c] < 4 / 255 ? 0 : Math.max(-difference, 0) / Math.max(field[c], 1 / 255);
			coverage = Math.max(coverage, positive, negative);
		}
		matte[i] = Math.min(1, coverage);
	}
	return matte;
}

function frameIndices(width: number, height: number): number[] {
	const frame: number[] = [];
	for (let x = 0; x < width; x++) frame.push(x, (height - 1) * width + x);
	for (let y = 0; y < height; y++) frame.push(y * width, y * width + width - 1);
	return frame;
}

export function sourceForegroundMatte(rgb: Buffer, width: number, height: number) {
	const count = width * height;
	const radius = new Float64Array(count);
	const bins = new Map<number, number[]>();
	let edgeCount = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			radius[i] = Math.sqrt(
				((x + 0.5 - width / 2) / (width / 2)) ** 2 + ((y + 0.5 - height / 2) / (height / 2)) ** 2,
			);
			if (radius[i] < 0.84 || radius[i] > 0.98) continue;
			const key =
				Math.floor((rgb[i * 3] / 255) * 15) * 256 +
				Math.floor((rgb[i * 3 + 1] / 255) * 15) * 16 +
				Math.floor((rgb[i * 3 + 2] / 255) * 15);
			const samples = bins.get(key) ?? [];
			samples.push(i);
			bins.set(key, samples);
			edgeCount++;
		}
	}
	if (!edgeCount) return null;
	// NumPy bincount.argmax selects the lowest key on ties.
	const dominant = [...bins.entries()].sort(([a, av], [b, bv]) => bv.length - av.length || a - b)[0][1];
	let background = fieldMedian(rgb, dominant);
	const dominance = dominant.length / edgeCount;
	const frame = frameIndices(width, height);
	if (dominance < 0.5) {
		const n = Math.max(2, roundEven(Math.min(width, height) * 0.06));
		const corners: number[] = [];
		for (let y = 0; y < n; y++)
			for (let x = 0; x < n; x++)
				corners.push(
					y * width + x,
					y * width + width - n + x,
					(height - n + y) * width + x,
					(height - n + y) * width + width - n + x,
				);
		const cornerField = fieldMedian(rgb, corners);
		const cornerAgreement = corners.filter((i) => distance(rgb, i, cornerField) < 0.04).length / corners.length;
		const frameAgreement = frame.filter((i) => distance(rgb, i, cornerField) < 0.04).length / frame.length;
		if (
			cornerAgreement > 0.95 &&
			frameAgreement > 0.8 &&
			Math.max(...cornerField.map((v, c) => Math.abs(v - background[c]))) > 0.1
		) {
			const candidate = matteFor(rgb, cornerField);
			// Only the selected field is a barrier. Preserve substantial white detail enclosed by that field.
			const open = Uint8Array.from({length: count}, (_, i) => Number(distance(rgb, i, background) >= 0.04));
			const reachable = new Uint8Array(count);
			const queue: number[] = [];
			const visit = (i: number) => {
				if (open[i] && !reachable[i]) {
					reachable[i] = 1;
					queue.push(i);
				}
			};
			for (const i of frame) visit(i);
			for (let head = 0; head < queue.length; head++) {
				const i = queue[head];
				if (i >= width) visit(i - width);
				if (i < count - width) visit(i + width);
				if (i % width) visit(i - 1);
				if (i % width < width - 1) visit(i + 1);
			}
			let inner = 0,
				filled = 0,
				enclosed = 0;
			for (let i = 0; i < count; i++) {
				if (radius[i] > 0.84) continue;
				inner++;
				if (candidate[i] > 0.5) filled++;
				if (distance(rgb, i, cornerField) < 0.04 && !reachable[i]) enclosed++;
			}
			if (filled / inner < 0.75 && enclosed / count <= 0.01) background = cornerField;
		}
	}
	const matte = matteFor(rgb, background);
	for (let i = 0; i < count; i++) if (radius[i] > 1) matte[i] = 0;
	return {matte, background, dominance, frame};
}

/** A bounded tonal lift only for repeated, strongly separated ink in compact colour palettes. */
function liftReadableInk(
	rgb: Buffer,
	alpha: Float64Array,
	matte: Float64Array,
	background: Colour,
	dominance: number,
	frame: number[],
): boolean {
	const core = Array.from(matte.keys()).filter((i) => matte[i] > 0.8);
	if (core.length < 16) return false;
	const uniformFrame = frame.filter((i) => distance(rgb, i, background) < 0.04).length / frame.length > 0.8;
	if (!(dominance > 0.85 || (dominance < 0.5 && uniformFrame))) return false;
	const reliable = Array.from(matte.keys()).filter((i) => matte[i] > 0.5 && distance(rgb, i, background) >= 32 / 255);
	if (reliable.length < 16) return false;
	const luminance = (i: number) =>
		(rgb[i * 3] / 255 - background[0]) * 0.2126 +
		(rgb[i * 3 + 1] / 255 - background[1]) * 0.7152 +
		(rgb[i * 3 + 2] / 255 - background[2]) * 0.0722;
	const direction = Math.sign(median(reliable.map(luminance)));
	let peak = 1;
	for (let i = 0; i < alpha.length; i++) peak = Math.max(peak, alpha[i] * matte[i]);
	const endpoints = new Map<number, number>();
	for (const i of reliable) {
		const delta = luminance(i);
		if (!(delta * direction > 0 || Math.abs(delta) >= 32 / 255) || (alpha[i] * matte[i] * 255) / peak >= 128)
			continue;
		const key = rgb[i * 3] * 65536 + rgb[i * 3 + 1] * 256 + rgb[i * 3 + 2];
		endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
	}
	if (![...endpoints.values()].some((count) => count >= Math.max(8, Math.ceil(reliable.length * 0.01)))) return false;
	let chromatic = 0,
		white = 0,
		black = 0;
	const bins = new Map<number, number>();
	for (const i of core) {
		const r = rgb[i * 3],
			g = rgb[i * 3 + 1],
			b = rgb[i * 3 + 2];
		const low = Math.min(r / 255, g / 255, b / 255),
			high = Math.max(r / 255, g / 255, b / 255);
		const chroma = high - low;
		if (chroma > 0.15) chromatic++;
		if (low > 0.9 && chroma < 0.05) white++;
		if (high < 0.15 && chroma < 0.05) black++;
		const key = Math.floor(r / 16) * 256 + Math.floor(g / 16) * 16 + Math.floor(b / 16);
		bins.set(key, (bins.get(key) ?? 0) + 1);
	}
	if (chromatic / core.length <= 0.1 || (white / core.length > 0.05 && black / core.length > 0.05)) return false;
	if (
		[...bins.values()]
			.sort((a, b) => b - a)
			.slice(0, 8)
			.reduce((sum, n) => sum + n, 0) /
			core.length <=
		0.9
	)
		return false;
	for (let i = 0; i < alpha.length; i++) alpha[i] = 0.85 * 255 + 0.15 * alpha[i];
	return true;
}

/** Pure cached-bitmap conversion. No source writes, identities, providers or runtime Python. */
export async function createMerchantLogoMask(image: Buffer): Promise<Buffer | null> {
	let decoded: {data: Buffer; info: OutputInfo};
	try {
		decoded = await sharp(image, {limitInputPixels: SIZE * SIZE})
			.removeAlpha()
			.toColourspace('srgb')
			.raw()
			.toBuffer({resolveWithObject: true});
	} catch {
		return null;
	}
	const {
		data: rgb,
		info: {width, height},
	} = decoded;
	const field = sourceForegroundMatte(rgb, width, height);
	if (!field) return null;
	const {matte, background, dominance, frame} = field;
	const alpha = aospAlpha(rgb);
	let solid = Array.from(matte.keys()).filter((i) => matte[i] > 0.5);
	if (!solid.length) solid = Array.from(matte.keys()).filter((i) => matte[i] > 0.1);
	if (!solid.length) return null;
	if (median(solid.map((i) => alpha[i])) < 128) for (let i = 0; i < alpha.length; i++) alpha[i] = 255 - alpha[i];
	// Placement uses pre-lift support so faint field noise cannot change the mark's scale or centring.
	const placement = Uint8Array.from(alpha, (a, i) => Number(roundEven(a * matte[i]) > 0));
	const lifted = liftReadableInk(rgb, alpha, matte, background, dominance, frame);
	const result = Uint8Array.from(alpha, (a, i) => clip(roundEven(a * matte[i])));
	let peak = 0;
	for (const value of result) peak = Math.max(peak, value);
	if (!peak) return null;
	for (let i = 0; i < result.length; i++) result[i] = clip(Math.floor((result[i] * 255) / peak + 0.5));
	if (lifted) for (const i of solid) placement[i] = 1;
	let left = width,
		top = height,
		right = 0,
		bottom = 0;
	for (let i = 0; i < result.length; i++) {
		if (!(lifted ? placement[i] : result[i])) continue;
		const x = i % width,
			y = Math.floor(i / width);
		left = Math.min(left, x);
		top = Math.min(top, y);
		right = Math.max(right, x + 1);
		bottom = Math.max(bottom, y + 1);
	}
	if (right <= left || bottom <= top) return null;
	const cropWidth = right - left,
		cropHeight = bottom - top;
	const scale = Math.min(MARK_SIZE / cropWidth, MARK_SIZE / cropHeight);
	const targetWidth = Math.max(1, roundEven(cropWidth * scale)),
		targetHeight = Math.max(1, roundEven(cropHeight * scale));
	const crop = new Uint8Array(cropWidth * cropHeight);
	for (let y = 0; y < cropHeight; y++)
		crop.set(result.subarray((top + y) * width + left, (top + y) * width + right), y * cropWidth);
	const resized = resizeMask(crop, cropWidth, cropHeight, targetWidth, targetHeight);
	const rgba = Buffer.alloc(SIZE * SIZE * 4, 255);
	for (let i = 0; i < SIZE * SIZE; i++) rgba[i * 4 + 3] = 0;
	const xOffset = Math.floor((SIZE - targetWidth) / 2),
		yOffset = Math.floor((SIZE - targetHeight) / 2);
	for (let y = 0; y < targetHeight; y++)
		for (let x = 0; x < targetWidth; x++)
			rgba[((y + yOffset) * SIZE + x + xOffset) * 4 + 3] = resized[y * targetWidth + x];
	return sharp(rgba, {raw: {width: SIZE, height: SIZE, channels: 4}})
		.png()
		.toBuffer();
}
