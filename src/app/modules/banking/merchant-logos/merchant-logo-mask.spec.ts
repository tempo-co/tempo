import {createHash} from 'node:crypto';
import sharp from 'sharp';

import {resizeMask} from './mask-resample';
import {createMerchantLogoMask, sourceForegroundMatte} from './merchant-logo-mask';

/** Synthetic RGB artwork; no downloaded assets or merchant metadata. */
function artwork(name: string): Buffer {
	const data = Buffer.alloc(128 * 128 * 3, 255);
	for (let y = 0; y < 128; y++)
		for (let x = 0; x < 128; x++) {
			let c = [255, 255, 255];
			const radius = Math.sqrt((x + 0.5 - 64) ** 2 + (y + 0.5 - 64) ** 2);
			if (name === 'shading' && x >= 32 && x < 96 && y >= 32 && y < 96)
				c = Array(3).fill(Math.floor(20 + (170 * (x - 32)) / 63));
			if (name === 'antialias')
				c = Array(3).fill(Math.floor(255 * (1 - Math.max(0, Math.min(1, 6 - Math.abs(radius - 30)))) + 0.5));
			if (name === 'noise') {
				c = [3, 63, 135];
				if (x >= 56 && x < 72 && y >= 56 && y < 72) c = [255, 255, 255];
				if (x >= 16 && x < 32 && y >= 48 && y < 80) c = [1, 64, 135];
			}
			if (name === 'palette' || name === 'fringe') {
				if (x >= 32 && x < 64 && y >= 32 && y < 96) c = [65, 64, 63];
				if (x >= 64 && x < 96 && y >= 32 && y < 96) c = [21, 158, 220];
				if (x >= 80 && x < 84 && y >= 40 && y < 44) c = [0, 0, 0];
				if (name === 'fringe' && x === 20 && y === 56) c = [254, 254, 254];
			}
			if (name === 'ring' && radius >= 37 && radius <= 63.5)
				c = [
					[44, 164, 81],
					[248, 185, 8],
					[230, 66, 49],
					[64, 130, 240],
				][Number(x >= 64) + 2 * Number(y >= 64)];
			if (name === 'badge' && radius <= 59) c = radius > 32 ? [0, 100, 60] : [255, 255, 255];
			if (name === 'closedbadge' && radius > 32) {
				const a = Math.max(0, Math.min(1, (61 - radius) / 4));
				c = [0, 100, 60].map((v) => Math.floor(255 + (v - 255) * a + 0.5));
			}
			if (name === 'details') {
				c = [192, 48, 32];
				if (x >= 32 && x < 96 && y >= 32 && y < 96) c = [255, 255, 255];
				if (x >= 56 && x < 72 && y >= 40 && y < 88) c = [0, 0, 0];
			}
			if (name === 'separated') {
				c = [32, 52, 85];
				if (x >= 32 && x < 60 && y >= 32 && y < 96) c = [255, 255, 255];
				if (x >= 68 && x < 96 && y >= 32 && y < 96) c = [0, 178, 170];
			}
			if (name === 'opposite') {
				c = [128, 128, 128];
				if (x >= 48 && x < 80 && y >= 48 && y < 104) c = [255, 255, 255];
				if (x >= 40 && x < 88 && y >= 24 && y < 40) c = [224, 0, 24];
			}
			for (let k = 0; k < 3; k++) data[(y * 128 + x) * 3 + k] = c[k];
		}
	return data;
}

// Decoded RGBA digests from the approved mathematical reference on these synthetic inputs.
const EXPECTED: Record<string, string> = {
	closedbadge: '1b8e59c474f7b1a17e2843be69bc03dcc7de8411b13c16314a544b46872d0d4f',
	shading: '971a0d3dcc5d0cedd9c4c3cf25d689c184393ea87a37c115933197b3b34517f2',
	antialias: 'af0240e33e5b73554fab96ef0dbb0addb2b62879b73d182e45d7ca790e4a49a4',
	noise: '3fd5a6c8dc61db7580db9ca556bde5adf06b450010ff5a49bd38edbb8e843a1e',
	palette: '0a68db8e7fb8f7444a86c556e739d4eede6eebab2c6cd95d29591669ab509d33',
	fringe: '0a68db8e7fb8f7444a86c556e739d4eede6eebab2c6cd95d29591669ab509d33',
	ring: 'cdd7de4b05b5bd1046a2a9e1b7ff529869ac7a5b41eea3fe4b69854a14be98a9',
	badge: '2cf2ab13e6c34d36ca0287506c68317585d2d864d6ef6764ccf7a4836966587e',
	details: '8c28ad9a68c0dbbb61036b3f6c8b00b0d08e634492dc7553bee208b0c0917110',
	separated: 'a9e7fb7b46af921ff45b64d62e70156c4822ee9bcd70b40abad86f0ccbac0ba2',
	opposite: 'b97c69d97acf03e9b1dcac486ebf908f5ce1125ef3538f5c7844a646d8cbb708',
};

describe('merchant logo mask', () => {
	it.each([
		[17, 5, 10, 3, '38147395da12b4279b1157255135ccb7f7786af94a32a4b2c4766a8ec07f293c'],
		[5, 17, 3, 10, '402627ccb2e11ae5531a54e2ce7e914d96c38c8805e0ad430fdfe0fbd290d4cf'],
		[5, 3, 9, 7, '443bdeddf8c5ccdda95c984de6859e6652a169a0e8f1a6debde38004bb5ce19f'],
		[1, 9, 1, 7, '06b58d448345a0a9ba3420555d1d8ad502488fa6534ebd585820a7eec5d3457c'],
		[7, 5, 7, 5, '5af2603e72f355902c046a165aca8fa009de51211db14f746e17bb89b3d60cd0'],
	] as const)(
		'matches Pillow byte rounding for a %ix%i mask resized to %ix%i',
		(width, height, outWidth, outHeight, digest) => {
			const source = Uint8Array.from({length: width * height}, (_, i) => {
				const x = i % width,
					y = Math.floor(i / width);
				return (x * 73 + y * 41 + x * y * 13) % 256;
			});
			expect(
				createHash('sha256')
					.update(resizeMask(source, width, height, outWidth, outHeight))
					.digest('hex'),
			).toBe(digest);
		},
	);

	it.each([
		{field: [3, 63, 135], noise: [1, 64, 135], ink: [255, 255, 255]},
		{field: [252, 192, 120], noise: [254, 191, 120], ink: [0, 0, 0]},
	])('gives near-gamut field noise low coverage over $field', ({field, noise, ink}) => {
		const rgb = Buffer.alloc(128 * 128 * 3);
		for (let i = 0; i < 128 * 128; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = field[c];
		for (let y = 48; y < 80; y++)
			for (let x = 16; x < 32; x++) for (let c = 0; c < 3; c++) rgb[(y * 128 + x) * 3 + c] = noise[c];
		for (let y = 56; y < 72; y++)
			for (let x = 56; x < 72; x++) for (let c = 0; c < 3; c++) rgb[(y * 128 + x) * 3 + c] = ink[c];
		const result = sourceForegroundMatte(rgb, 128, 128)!;
		expect(result.matte[64 * 128 + 24]).toBeLessThan(0.02);
		expect(result.matte[64 * 128 + 64]).toBeGreaterThan(0.99);
	});
	it('preserves the enclosing field of a detailed badge with a weak annulus estimate', () => {
		const result = sourceForegroundMatte(artwork('closedbadge'), 128, 128)!;
		expect(result.dominance).toBeLessThan(0.5);
		expect(result.background).toEqual([0, 100 / 255, 60 / 255]);
	});
	it.each(['uniform', 'invalid', 'oversized'])('refuses an unconvertible %s input', async (kind) => {
		const source =
			kind === 'invalid'
				? Buffer.from('synthetic invalid PNG')
				: await sharp({
						create: {
							width: kind === 'oversized' ? 129 : 128,
							height: 128,
							channels: 3,
							background: 'white',
						},
					})
						.png()
						.toBuffer();
		expect(await createMerchantLogoMask(source)).toBeNull();
	});

	it.each(Object.entries(EXPECTED))(
		'preserves the approved decoded pixels for synthetic %s artwork',
		async (name, digest) => {
			const source = await sharp(artwork(name), {raw: {width: 128, height: 128, channels: 3}})
				.png()
				.toBuffer();
			const original = Buffer.from(source);
			const png = await createMerchantLogoMask(source);
			expect(png).not.toBeNull();
			const {data, info} = await sharp(png!).ensureAlpha().raw().toBuffer({resolveWithObject: true});
			expect(info).toMatchObject({width: 128, height: 128, channels: 4});
			const opacity = Array.from({length: 128 * 128}, (_, i) => data[i * 4 + 3]);
			if (name === 'shading') {
				expect(new Set(opacity).size).toBeGreaterThan(30);
				const visible = opacity.flatMap((a, i) => (a ? [i] : []));
				expect([
					Math.min(...visible.map((i) => i % 128)),
					Math.min(...visible.map((i) => Math.floor(i / 128))),
					Math.max(...visible.map((i) => i % 128)) + 1,
					Math.max(...visible.map((i) => Math.floor(i / 128))) + 1,
				]).toEqual([12, 12, 116, 116]);
			}
			if (name === 'antialias') expect(new Set(opacity.filter((a) => a > 0 && a < 255)).size).toBeGreaterThan(10);
			expect(createHash('sha256').update(data).digest('hex')).toBe(digest);
			expect(source).toEqual(original);
		},
	);
});
