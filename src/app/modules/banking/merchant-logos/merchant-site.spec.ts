import sharp from 'sharp';

import {encodeMerchantLogo, iconCandidates, parseHomepage, siteMatchesBrand} from './merchant-site';

function png(width: number, height = width): Promise<Buffer> {
	return sharp({create: {width, height, channels: 4, background: {r: 200, g: 40, b: 40, alpha: 0.5}}})
		.png()
		.toBuffer();
}

/** An ICO container holding the given PNG images, as browsers and sites serve them. */
function ico(images: {size: number; bytes: Buffer}[]): Buffer {
	const header = Buffer.alloc(6 + images.length * 16);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = header.length;
	images.forEach(({size, bytes}, index) => {
		const entry = 6 + index * 16;
		header[entry] = size === 256 ? 0 : size;
		header[entry + 1] = size === 256 ? 0 : size;
		header.writeUInt32LE(bytes.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += bytes.length;
	});
	return Buffer.concat([header, ...images.map(({bytes}) => bytes)]);
}

/** A 24-bit ICO bitmap filled with one colour, its top-left pixel marked transparent by the mask. */
function bitmap(size: number, [red, green, blue]: [number, number, number]): Buffer {
	const stride = Math.ceil((size * 24) / 32) * 4;
	const maskStride = Math.ceil(size / 32) * 4;
	const data = Buffer.alloc(40 + stride * size + maskStride * size);
	data.writeUInt32LE(40, 0);
	data.writeInt32LE(size, 4);
	data.writeInt32LE(size * 2, 8);
	data.writeUInt16LE(1, 12);
	data.writeUInt16LE(24, 14);
	for (let row = 0; row < size; row++)
		for (let x = 0; x < size; x++) data.set([blue, green, red], 40 + row * stride + x * 3);
	// Rows are stored bottom-up, so the image's top row is the last mask row.
	data[40 + stride * size + (size - 1) * maskStride] = 0x80;
	return data;
}

describe('parseHomepage', () => {
	it('reads the site names and raster icons, largest first, resolved against the page and its base', () => {
		const homepage = parseHomepage(
			`<!doctype html><html><head>
				<title>  Example Shop |  Groceries online </title>
				<base href="https://cdn.example.test/assets/">
				<meta property="og:site_name" content="Example Shop">
				<meta name="application-name" content="Example">
				<link rel="icon" href="/favicon-32.png" sizes="32x32">
				<LINK REL="Apple-Touch-Icon" href="touch.png">
				<link rel="icon" type="image/svg+xml" href="/icon.svg">
				<link rel="mask-icon" href="/mask.png">
				<link rel="shortcut icon" href="icon-192.png" sizes="192x192 16x16">
			</head><body>Welcome</body></html>`,
			'https://shop.example.test/',
		);
		expect(homepage).toEqual({
			names: ['Example Shop | Groceries online', 'Example Shop', 'Example'],
			icons: [
				{url: 'https://cdn.example.test/assets/icon-192.png', size: 192},
				{url: 'https://cdn.example.test/assets/touch.png', size: 180},
				{url: 'https://cdn.example.test/favicon-32.png', size: 32},
			],
			parked: false,
		});
		expect(iconCandidates(homepage, 'https://shop.example.test/')).toEqual([
			'https://cdn.example.test/assets/icon-192.png',
			'https://cdn.example.test/assets/touch.png',
			'https://cdn.example.test/favicon-32.png',
			'https://shop.example.test/apple-touch-icon.png',
			'https://shop.example.test/favicon.ico',
		]);
	});

	it('recognizes a parked domain page', () => {
		expect(
			parseHomepage(
				'<title>shop.example.test</title><h1>This domain is for sale</h1>',
				'https://shop.example.test/',
			).parked,
		).toBe(true);
	});
});

describe('siteMatchesBrand', () => {
	it.each([
		['Example Shop', 'shop.test', ['Welcome to Example Shop'], true],
		['Example Shop', 'shop.test', ['Groceries', 'EXAMPLE-SHOP Online'], true],
		['Exampleshop', 'shop.test', ['Example Shop | Groceries'], true],
		['Example Shop', 'shop.test', ['ExampleShop Online'], true],
		['Example Mart', 'plumber.test', ['Example Martin Plumbing'], false],
		['Café Example', 'brand.test', ['Cafe Example | Coffee'], true],
		['Example Shop', 'exampleshop.test', ['Another Business'], false],
		['Ex', 'brand.test', ['Expert Cleaning'], false],
		['Example Shop', 'example-shop.test', [], true],
		['Example Shop', 'examples.test', [], false],
	])('%s at %s named %j matches: %s', (brand, domain, names, expected) => {
		expect(siteMatchesBrand(brand, domain, names)).toBe(expected);
	});
});

describe('encodeMerchantLogo (real sharp)', () => {
	it('turns a non-square transparent icon into a square PNG on white, at most 128px', async () => {
		const output = await encodeMerchantLogo(await png(300, 150));
		const metadata = await sharp(output).metadata();
		expect(metadata).toMatchObject({format: 'png', width: 128, height: 128, hasAlpha: false});
		const [corner] = await sharp(output).raw().toBuffer();
		expect(corner).toBe(255);
	});

	it('uses the largest PNG inside an ICO and keeps small icons at their own size', async () => {
		const output = await encodeMerchantLogo(
			ico([
				{size: 16, bytes: await png(16)},
				{size: 48, bytes: await png(48)},
			]),
		);
		expect(await sharp(output).metadata()).toMatchObject({width: 48, height: 48});
	});

	it('decodes a bitmap inside an ICO, with its transparency mask', async () => {
		const output = await encodeMerchantLogo(
			ico([
				{size: 16, bytes: await png(16)},
				{size: 32, bytes: bitmap(32, [200, 40, 40])},
			]),
		);
		const {data, info} = await sharp(output).raw().toBuffer({resolveWithObject: true});
		expect(info).toMatchObject({width: 32, height: 32, channels: 3});
		expect([...data.subarray(0, 6)]).toEqual([255, 255, 255, 200, 40, 40]);
	});

	it.each([
		['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>')],
		['HTML', Buffer.from('<html><body>Not found</body></html>')],
		['an ICO without a readable image', ico([{size: 32, bytes: Buffer.alloc(64, 1)}])],
		['an ICO bitmap cut short', ico([{size: 32, bytes: bitmap(32, [200, 40, 40]).subarray(0, 200)}])],
	])('rejects %s', async (_, bytes) => {
		await expect(encodeMerchantLogo(bytes)).rejects.toThrow();
	});

	it('rejects an icon too small to show', async () => {
		await expect(encodeMerchantLogo(await png(8))).rejects.toThrow('Unusable icon.');
	});
});
