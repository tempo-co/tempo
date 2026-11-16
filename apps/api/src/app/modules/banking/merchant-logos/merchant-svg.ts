import {spawn} from 'node:child_process';

/** SVG icons are rendered to a square of this many pixels before they are encoded like any raster icon. */
export const SVG_RENDER_SIZE = 512;
const MAX_SVG_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 5000;

/**
 * Runs in its own process with an empty environment, with only sharp's SVG buffer loader enabled. librsvg loads no
 * external references (images, stylesheets, entities) from a buffer, and a render that runs long is killed: sharp's
 * own timeout cannot stop librsvg mid-render.
 */
const RENDERER = `
const sharp = require(process.argv[1]);
const size = Number(process.argv[2]);
sharp.block({operation: ['VipsForeignLoad']});
sharp.unblock({operation: ['VipsForeignLoadSvgBuffer']});
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk)).on('end', async () => {
	try {
		const svg = Buffer.concat(chunks);
		const {width = 0, height = 0} = await sharp(svg, {limitInputPixels: false}).metadata();
		const density = Math.min(100000, Math.max(1, (72 * size) / Math.max(width, height, 1)));
		const png = await sharp(svg, {density, limitInputPixels: 4 * size * size, failOn: 'error'})
			.resize(size, size, {fit: 'inside'})
			.png()
			.toBuffer();
		process.stdout.write(png, () => process.exit(0));
	} catch {
		process.exit(1);
	}
});
`;

/**
 * Whether bytes are an SVG document rather than a raster image or an HTML page: within the first 4096 bytes, after an
 * optional byte order mark, an optional XML declaration, comments and an optional SVG doctype, the root element is
 * `<svg`. Scans forward only, so its time is linear in the head whatever the bytes are.
 */
export function isSvg(bytes: Buffer): boolean {
	const head = bytes
		.subarray(0, 4096)
		.toString('utf8')
		.replace(/^\uFEFF/, '')
		.toLowerCase();
	const whitespace = /\s*/y;
	const svgDoctype = /<!doctype\s+svg/y;
	let at = 0;
	const skipWhitespace = () => {
		whitespace.lastIndex = at;
		whitespace.test(head);
		at = whitespace.lastIndex;
	};
	/** Moves past the markup that starts here and ends at `close`; false when it never ends. */
	const skipPast = (close: string, from: number) => {
		const end = head.indexOf(close, from);
		if (end < 0) return false;
		at = end + close.length;
		return true;
	};

	skipWhitespace();
	if (head.startsWith('<?xml', at)) {
		// Like `<?xml[^>]*?>`: the declaration ends at its first `>`, which must follow a `?`.
		const end = head.indexOf('>', at + 5);
		if (end < 0 || end - 1 < at + 5 || head[end - 1] !== '?') return false;
		at = end + 1;
		skipWhitespace();
	}
	let doctype = false;
	for (;;) {
		svgDoctype.lastIndex = at;
		if (head.startsWith('<!--', at)) {
			if (!skipPast('-->', at + 4)) return false;
		} else if (!doctype && svgDoctype.test(head)) {
			if (!skipPast('>', svgDoctype.lastIndex)) return false;
			doctype = true;
		} else {
			return head.startsWith('<svg', at) && /[\s>]/.test(head.charAt(at + 4));
		}
		skipWhitespace();
	}
}

/** Renders an SVG to a PNG whose longer side is SVG_RENDER_SIZE; rejects anything that fails or takes too long. */
export function rasterizeSvg(svg: Buffer): Promise<Buffer> {
	if (svg.length > MAX_SVG_BYTES) return Promise.reject(new Error('SVG too large.'));
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['-e', RENDERER, require.resolve('sharp'), String(SVG_RENDER_SIZE)], {
			stdio: ['pipe', 'pipe', 'ignore'],
			env: {},
			timeout: RENDER_TIMEOUT_MS,
			killSignal: 'SIGKILL',
		});
		const chunks: Buffer[] = [];
		let size = 0;
		child.stdout.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_OUTPUT_BYTES) child.kill('SIGKILL');
			else chunks.push(chunk);
		});
		child.once('error', () => reject(new Error('SVG render failed.')));
		child.once('close', (code) => {
			if (code === 0 && size <= MAX_OUTPUT_BYTES) resolve(Buffer.concat(chunks));
			else reject(new Error('SVG render failed.'));
		});
		// The child may exit before reading everything; that is reported by its exit code.
		child.stdin.once('error', () => {});
		child.stdin.end(svg);
	});
}
