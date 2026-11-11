import sharp from 'sharp';

// Installs the same raster-only sharp loader policy used for merchant images.
import '../merchant-logos/merchant-site';
import {isSvg, rasterizeSvg} from '../merchant-logos/merchant-svg';

export const BANK_LOGO_VERSION = 'colour-v2';

/** Original-colour artwork with only a qualifying edge-connected near-white matte removed. */
export async function convertBankLogo(original: Buffer): Promise<Buffer> {
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
	removeEdgeBackground(light, info.width, info.height);
	if (!light.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('Empty bank logo.');
	return sharp(light, {raw: {width: info.width, height: info.height, channels: 4}})
		.png()
		.toBuffer();
}

function removeEdgeBackground(data: Buffer, width: number, height: number): void {
	const candidate = (pixel: number) => {
		const i = pixel * 4;
		const min = Math.min(data[i], data[i + 1], data[i + 2]);
		return min >= 235 && Math.max(data[i], data[i + 1], data[i + 2]) - min <= 18 && data[i + 3] >= 245;
	};
	const corners = [0, width - 1, (height - 1) * width, width * height - 1];
	if (corners.filter(candidate).length < 3) return;
	const boundary: number[] = [];
	for (let x = 0; x < width; x++) {
		boundary.push(x);
		if (height > 1) boundary.push((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y++) {
		boundary.push(y * width);
		if (width > 1) boundary.push(y * width + width - 1);
	}
	if (boundary.filter(candidate).length / boundary.length < 0.65) return;
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
}
