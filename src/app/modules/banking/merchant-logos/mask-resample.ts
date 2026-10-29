/*
 * Pillow-compatible 8-bit LANCZOS resampling, translated from libImaging/Resample.c.
 * Copyright © 1997-2011 Secret Labs AB
 * Copyright © 1995-2011 Fredrik Lundh and contributors
 * Copyright © 2010 Jeffrey 'Alex' Clark and contributors
 * See licenses/PILLOW.txt for the MIT-CMU permission and warranty notice.
 */

const PRECISION = 2 ** 22;
const clip = (value: number) => Math.max(0, Math.min(255, value));

function sinc(x: number): number {
	if (x === 0) return 1;
	const angle = x * Math.PI;
	return Math.sin(angle) / angle;
}

function coefficients(input: number, output: number): {start: number; weights: number[]}[] {
	const scale = input / output;
	const filterScale = Math.max(1, scale);
	const support = 3 * filterScale;
	const inverse = 1 / filterScale;
	return Array.from({length: output}, (_, index) => {
		const center = (index + 0.5) * scale;
		const start = Math.max(0, Math.trunc(center - support + 0.5));
		const end = Math.min(input, Math.trunc(center + support + 0.5));
		const weights = Array.from({length: end - start}, (_, offset) => {
			const x = (offset + start - center + 0.5) * inverse;
			return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
		});
		const sum = weights.reduce((total, weight) => total + weight, 0);
		return {
			start,
			weights: weights.map((weight) => {
				const normalized = sum ? weight / sum : weight;
				return Math.trunc(normalized * PRECISION + (normalized < 0 ? -0.5 : 0.5));
			}),
		};
	});
}

/** Preserve Pillow's coefficient quantization, pass order and intermediate byte rounding. */
export function resizeMask(
	input: Uint8Array,
	width: number,
	height: number,
	outputWidth: number,
	outputHeight: number,
): Uint8Array {
	let data = input;
	let currentWidth = width;
	let currentHeight = height;
	const horizontal = () => {
		if (currentWidth === outputWidth) return;
		const table = coefficients(currentWidth, outputWidth);
		const output = new Uint8Array(outputWidth * currentHeight);
		for (let y = 0; y < currentHeight; y++) {
			for (let x = 0; x < outputWidth; x++) {
				const {start, weights} = table[x];
				let sum = PRECISION / 2;
				for (let i = 0; i < weights.length; i++) sum += data[y * currentWidth + start + i] * weights[i];
				output[y * outputWidth + x] = clip(Math.floor(sum / PRECISION));
			}
		}
		data = output;
		currentWidth = outputWidth;
	};
	const vertical = () => {
		if (currentHeight === outputHeight) return;
		const table = coefficients(currentHeight, outputHeight);
		const output = new Uint8Array(currentWidth * outputHeight);
		for (let y = 0; y < outputHeight; y++) {
			const {start, weights} = table[y];
			for (let x = 0; x < currentWidth; x++) {
				let sum = PRECISION / 2;
				for (let i = 0; i < weights.length; i++) sum += data[(start + i) * currentWidth + x] * weights[i];
				output[y * currentWidth + x] = clip(Math.floor(sum / PRECISION));
			}
		}
		data = output;
		currentHeight = outputHeight;
	};
	// Pillow 12.3 rounds the horizontal intermediate to bytes before the vertical pass.
	horizontal();
	vertical();
	return data;
}
