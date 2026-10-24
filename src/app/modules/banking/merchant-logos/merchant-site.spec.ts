import sharp from 'sharp';

import {
	MerchantLogoCandidate,
	chooseMerchantLogos,
	encodeMerchantLogo,
	iconCandidates,
	isPlatformDefaultIcon,
	parseHomepage,
	parseManifestIcons,
	siteMatchesBrand,
} from './merchant-site';

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

/** An 8-bit paletted ICO bitmap: the left half palette colour 1, the right half colour 2, no transparent pixels. */
function palettedBitmap(size: number, colours: [number, number, number][]): Buffer {
	const stride = Math.ceil((size * 8) / 32) * 4;
	const maskStride = Math.ceil(size / 32) * 4;
	const table = 40 + 256 * 4;
	const data = Buffer.alloc(table + stride * size + maskStride * size);
	data.writeUInt32LE(40, 0);
	data.writeInt32LE(size, 4);
	data.writeInt32LE(size * 2, 8);
	data.writeUInt16LE(1, 12);
	data.writeUInt16LE(8, 14);
	colours.forEach(([red, green, blue], index) => data.set([blue, green, red, 0], 40 + index * 4));
	for (let row = 0; row < size; row++)
		for (let x = 0; x < size; x++) data[table + row * stride + x] = x < size / 2 ? 1 : 2;
	return data;
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
	it('reads the site names, icons and manifest; icons are tried largest first, vector first', () => {
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
				<link rel="icon" href="http://shop.example.test/legacy.ico">
				<link rel="manifest" href="/site.webmanifest">
			</head><body>Welcome</body></html>`,
			'https://shop.example.test/',
		);
		expect(homepage).toEqual({
			names: ['Example Shop | Groceries online', 'Example Shop', 'Example'],
			icons: [
				{url: 'https://cdn.example.test/favicon-32.png', size: 32},
				{url: 'https://cdn.example.test/assets/touch.png', size: 180},
				{url: 'https://cdn.example.test/icon.svg', size: 512},
				{url: 'https://cdn.example.test/assets/icon-192.png', size: 192},
				{url: 'http://shop.example.test/legacy.ico', size: 32},
			],
			manifest: 'https://cdn.example.test/site.webmanifest',
			parked: false,
		});
		const manifestIcons = parseManifestIcons(
			JSON.stringify({
				name: 'Example Shop',
				icons: [
					{src: 'android-512.png', sizes: '512x512', type: 'image/png'},
					{src: 'mono.png', sizes: '1024x1024', purpose: 'monochrome'},
					{src: 'javascript:alert(1)', sizes: '2048x2048'},
					{sizes: '256x256'},
				],
			}),
			'https://cdn.example.test/site.webmanifest',
			'shop.example.test',
		);
		expect(manifestIcons).toEqual([{url: 'https://cdn.example.test/android-512.png', size: 512}]);
		// A manifest named after the software the site runs on, or not named at all, isn't the brand's app.
		const generic = (manifest: object) =>
			parseManifestIcons(JSON.stringify(manifest), 'https://shop.example.test/m.json', 'shop.example.test');
		expect(generic({name: 'Webshop', icons: [{src: 'icon.png', sizes: '512x512'}]})).toEqual([]);
		expect(generic({icons: [{src: 'icon.png', sizes: '512x512'}]})).toEqual([]);
		expect(generic({short_name: 'Shop', icons: [{src: 'icon.png', sizes: '512x512'}]})).toHaveLength(1);
		// A very long name is read in time proportional to its length.
		const started = Date.now();
		expect(generic({name: 'x '.repeat(32_000), icons: [{src: 'icon.png', sizes: '512x512'}]})).toEqual([]);
		expect(Date.now() - started).toBeLessThan(500);
		// The page's own icons first, then the manifest's, then the conventional paths.
		expect(iconCandidates(homepage, 'https://shop.example.test/', manifestIcons)).toEqual([
			'https://cdn.example.test/icon.svg',
			'https://cdn.example.test/assets/icon-192.png',
			'https://cdn.example.test/assets/touch.png',
			'https://cdn.example.test/favicon-32.png',
			'https://shop.example.test/legacy.ico',
			'https://cdn.example.test/android-512.png',
			'https://shop.example.test/favicon.svg',
			'https://shop.example.test/apple-touch-icon.png',
			'https://shop.example.test/apple-touch-icon-precomposed.png',
			'https://shop.example.test/favicon.ico',
		]);
		// A homepage that refused us still leaves the conventional paths to try.
		expect(iconCandidates(null, 'https://shop.example.test/')).toEqual([
			'https://shop.example.test/favicon.svg',
			'https://shop.example.test/apple-touch-icon.png',
			'https://shop.example.test/apple-touch-icon-precomposed.png',
			'https://shop.example.test/favicon.ico',
		]);
		expect(parseManifestIcons('not json', 'https://cdn.example.test/m.json', 'shop.example.test')).toEqual([]);
	});

	it.each([
		['https://shop.example.test/wp-includes/images/w-logo-blue.png', true],
		['https://shop.example.test/wp-content/uploads/logo.png', false],
	])('treats %s as a platform default icon: %s', (url, expected) => {
		expect(isPlatformDefaultIcon(url)).toBe(expected);
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
		['Examplers', 'brand.test', ['Welcome to J D Exampler'], true],
		['Exampler', 'brand.test', ["Examplers' Pubs"], true],
		['Bar', 'brand.test', ['Bars of the World'], false],
		['Example Play', 'play.example.test', [], true],
		['Example Play', 'example.test', [], false],
		['Example', 'play.example.test', [], true],
	])('%s at %s named %j matches: %s', (brand, domain, names, expected) => {
		expect(siteMatchesBrand(brand, domain, names)).toBe(expected);
	});
});

describe('encodeMerchantLogo (real sharp)', () => {
	it('turns a non-square transparent icon into a square PNG on white, at most 128px', async () => {
		const {png: output, size, monochrome} = await encodeMerchantLogo(await png(300, 150));
		const metadata = await sharp(output).metadata();
		expect(metadata).toMatchObject({format: 'png', width: 128, height: 128, hasAlpha: false});
		expect(size).toBe(150);
		expect(monochrome).toBe(false);
		const [corner] = await sharp(output).raw().toBuffer();
		expect(corner).toBe(255);
	});

	it('marks a logo as monochrome when under 1% of its pixels have colour', async () => {
		const dotted = (dots: number) =>
			sharp({create: {width: 100, height: 100, channels: 3, background: '#1b1f3a'}})
				.composite(
					Array.from({length: dots}, (_, index) => ({
						input: {create: {width: 1, height: 1, channels: 3, background: '#e30613'}},
						left: index % 100,
						top: Math.floor(index / 100),
					})),
				)
				.png()
				.toBuffer();
		expect((await encodeMerchantLogo(await dotted(80))).monochrome).toBe(true);
		expect((await encodeMerchantLogo(await dotted(300))).monochrome).toBe(false);
	});

	it('marks a logo with no colour as monochrome', async () => {
		const grey = await sharp({create: {width: 64, height: 64, channels: 3, background: '#1b1f3a'}})
			.png()
			.toBuffer();
		expect((await encodeMerchantLogo(grey)).monochrome).toBe(true);
	});

	it('renders an SVG sharply at 128px, without loading anything it references', async () => {
		const svg = Buffer.from(
			`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
				viewBox="0 0 16 16"><rect width="8" height="16" fill="#c82828"/>
				<image x="8" width="8" height="16" xlink:href="file:///etc/hostname"/>
				<image x="8" width="8" height="16" xlink:href="https://shop.example.test/x.png"/></svg>`,
		);
		const {png: output, size} = await encodeMerchantLogo(svg);
		expect(size).toBe(512);
		const {data, info} = await sharp(output).raw().toBuffer({resolveWithObject: true});
		expect(info).toMatchObject({width: 128, height: 128});
		// Resampling may shift a colour by a few levels.
		const near = (x: number, colour: number[]) =>
			data
				.subarray((64 * 128 + x) * 3, (64 * 128 + x) * 3 + 3)
				.every((value, i) => Math.abs(value - colour[i]) <= 4);
		// Crisp at the edge of the red half, and nothing drawn where the references point.
		expect(near(62, [200, 40, 40])).toBe(true);
		expect(near(66, [255, 255, 255])).toBe(true);
	});

	it('uses the largest PNG inside an ICO and keeps small icons at their own size', async () => {
		const {png: output, size} = await encodeMerchantLogo(
			ico([
				{size: 16, bytes: await png(16)},
				{size: 48, bytes: await png(48)},
			]),
		);
		expect(await sharp(output).metadata()).toMatchObject({width: 48, height: 48});
		expect(size).toBe(48);
	});

	it('decodes a bitmap inside an ICO, with its transparency mask', async () => {
		const {png: output} = await encodeMerchantLogo(
			ico([
				{size: 16, bytes: await png(16)},
				{size: 32, bytes: bitmap(32, [200, 40, 40])},
			]),
		);
		const {data, info} = await sharp(output).raw().toBuffer({resolveWithObject: true});
		expect(info).toMatchObject({width: 32, height: 32, channels: 3});
		expect([...data.subarray(0, 6)]).toEqual([255, 255, 255, 200, 40, 40]);
	});

	it('decodes a paletted bitmap inside an ICO', async () => {
		const {png: output} = await encodeMerchantLogo(
			ico([
				{
					size: 32,
					bytes: palettedBitmap(32, [
						[0, 0, 0],
						[200, 40, 40],
						[40, 40, 200],
					]),
				},
			]),
		);
		const {data} = await sharp(output).raw().toBuffer({resolveWithObject: true});
		expect([...data.subarray(0, 3)]).toEqual([200, 40, 40]);
		expect([...data.subarray(31 * 3, 32 * 3)]).toEqual([40, 40, 200]);
	});

	it.each([
		[
			'an SVG that comes out blank: a white mark for dark tabs',
			Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#fff"/></svg>',
			),
		],
		['an SVG that is not well formed', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>')],
		['HTML', Buffer.from('<html><body>Not found</body></html>')],
		['an ICO without a readable image', ico([{size: 32, bytes: Buffer.alloc(64, 1)}])],
		['an ICO bitmap cut short', ico([{size: 32, bytes: bitmap(32, [200, 40, 40]).subarray(0, 200)}])],
	])('rejects %s', async (_, bytes) => {
		await expect(encodeMerchantLogo(bytes)).rejects.toThrow();
	});

	it('rejects an SVG that takes too long to render', async () => {
		const strokes =
			'<path d="M0 0C9999 -9999 -9999 9999 1024 1024" fill="none" stroke="red" stroke-width="5000" stroke-dasharray="0.01"/>';
		const slow = Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${strokes.repeat(500)}</svg>`,
		);
		const started = Date.now();
		await expect(encodeMerchantLogo(slow)).rejects.toThrow('SVG render failed.');
		expect(Date.now() - started).toBeLessThan(8000);
	}, 15_000);

	it('rejects an icon too small to show', async () => {
		await expect(encodeMerchantLogo(await png(8))).rejects.toThrow('Unusable icon.');
	});
});

describe('chooseMerchantLogos', () => {
	const merchant = (
		key: string,
		brand: string | null,
		logo: Partial<NonNullable<MerchantLogoCandidate['logo']>> | null,
		domainConfident = false,
	): MerchantLogoCandidate => ({
		key,
		brand,
		domain: logo ? `${key.replace(/\W/g, '')}.test` : null,
		domainConfident,
		logo: logo && {
			id: `logo-${key}`,
			status: 'READY',
			version: `v-${key}`,
			siteNames: [brand ?? ''],
			homepageLoaded: true,
			sourceSize: 32,
			monochrome: false,
			...logo,
		},
	});

	it('shows each brand its best confirmed logo, colour before size, on every merchant of that brand', () => {
		const chosen = chooseMerchantLogos([
			merchant('example nl', 'Example Burger', {sourceSize: 32}),
			merchant('example uk', 'EXAMPLE burger', {sourceSize: 48}),
			merchant('example station', 'Example Burger', null),
			merchant('example be', 'Example Burger', {sourceSize: 48}),
			merchant('other', 'Other Shop', {sourceSize: 180}),
			merchant('chain ro', 'Example Chain', {sourceSize: 512, monochrome: true}),
			merchant('chain com', 'Example Chain', {sourceSize: 400}),
		]);
		expect(Object.fromEntries(chosen)).toEqual({
			'example nl': {id: 'logo-example uk', version: 'v-example uk'},
			'example uk': {id: 'logo-example uk', version: 'v-example uk'},
			'example station': {id: 'logo-example uk', version: 'v-example uk'},
			'example be': {id: 'logo-example be', version: 'v-example be'},
			other: {id: 'logo-other', version: 'v-other'},
			'chain ro': {id: 'logo-chain com', version: 'v-chain com'},
			'chain com': {id: 'logo-chain com', version: 'v-chain com'},
		});
	});

	it('shows a logo only when the homepage named the brand, or named nothing against it', () => {
		const chosen = chooseMerchantLogos([
			merchant('unnamed sure', 'Unnamed Shop Plus', {siteNames: []}, true),
			merchant('unnamed guess', 'Guessed Plus', {siteNames: []}, false),
			merchant('unnamedhost', 'Unnamedhost', {siteNames: []}, false),
			merchant('sure but other', 'Sure Shop', {siteNames: ['Unrelated Business']}, true),
			merchant('mismatch', 'Example Shop', {siteNames: ['Unrelated Business']}),
			merchant('blocked sure', 'Blocked Shop', {homepageLoaded: false, siteNames: []}, true),
			merchant('blocked guess', 'Guessed Shop', {homepageLoaded: false, siteNames: []}, false),
			merchant('pending', 'Pending Shop', {status: 'PENDING', version: null}),
			merchant('person', null, null),
		]);
		expect([...chosen.keys()]).toEqual(['unnamed sure', 'unnamedhost', 'blocked sure']);
	});
});
