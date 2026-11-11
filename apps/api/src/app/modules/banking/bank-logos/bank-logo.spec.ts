import sharp from 'sharp';

import {convertBankLogo} from './bank-logo';

async function png(pixels: Buffer, width: number, height: number) {
	return sharp(pixels, {raw: {width, height, channels: 4}})
		.png()
		.toBuffer();
}
async function pixels(image: Buffer) {
	return sharp(image).ensureAlpha().raw().toBuffer();
}

describe('bank logo conversion', () => {
	it('removes an edge-connected white field while preserving enclosed white and brand ink', async () => {
		const width = 20;
		const data = Buffer.alloc(width * width * 4, 255);
		for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) data.set([10, 70, 180, 255], (y * width + x) * 4);
		data.set([255, 255, 255, 255], (10 * width + 10) * 4);
		const result = await convertBankLogo(await png(data, width, width));
		const light = await pixels(result);
		expect([...light.subarray(0, 4)]).toEqual([255, 255, 255, 0]);
		expect([...light.subarray((10 * width + 10) * 4, (10 * width + 10) * 4 + 4)]).toEqual([255, 255, 255, 255]);
		expect([...light.subarray((5 * width + 5) * 4, (5 * width + 5) * 4 + 4)]).toEqual([10, 70, 180, 255]);
	});

	it('preserves backing below 65% of the unique boundary', async () => {
		const width = 20;
		const data = Buffer.alloc(width * width * 4);
		const boundary = [
			...new Set([
				...Array.from({length: width}, (_, x) => x),
				...Array.from({length: width}, (_, x) => (width - 1) * width + x),
				...Array.from({length: width}, (_, y) => y * width),
				...Array.from({length: width}, (_, y) => y * width + width - 1),
			]),
		];
		const corners = [0, width - 1, (width - 1) * width, width * width - 1];
		const white = [...corners, ...boundary.filter((pixel) => !corners.includes(pixel)).slice(0, 44)];
		for (const pixel of white) data.set([255, 255, 255, 255], pixel * 4);
		data.set([0, 20, 90, 255], (10 * width + 10) * 4);
		expect(await pixels(await convertBankLogo(await png(data, width, width)))).toEqual(data);
	});

	it('rejects an empty result', async () => {
		await expect(convertBankLogo(await png(Buffer.alloc(20 * 20 * 4, 255), 20, 20))).rejects.toThrow();
	});

	it('preserves neutral ink, saturated colours and alpha', async () => {
		const source = Buffer.from([0, 0, 0, 255, 100, 105, 110, 200, 0, 90, 180, 128, 140, 10, 20, 255]);
		expect(await pixels(await convertBankLogo(await png(source, 4, 1)))).toEqual(source);
	});

	it('preserves white lettering on transparent edges and enclosed backing', async () => {
		const sparse = Buffer.alloc(20 * 20 * 4);
		for (let y = 0; y < 20; y++) sparse.set([255, 255, 255, 255], (y * 20 + 10) * 4);
		expect(await pixels(await convertBankLogo(await png(sparse, 20, 20)))).toEqual(sparse);
		const badge = Buffer.alloc(20 * 20 * 4);
		for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) badge.set([255, 255, 255, 255], (y * 20 + x) * 4);
		for (let y = 6; y < 14; y++) for (let x = 6; x < 14; x++) badge.set([0, 0, 0, 255], (y * 20 + x) * 4);
		expect(await pixels(await convertBankLogo(await png(badge, 20, 20)))).toEqual(badge);
	});
});
