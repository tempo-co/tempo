import * as ipaddr from 'ipaddr.js';
import {LookupAddress} from 'node:dns';
import {lookup} from 'node:dns/promises';
import {IncomingMessage} from 'node:http';
import {request} from 'node:https';
import {Transform, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createBrotliDecompress, createGunzip, createInflate} from 'node:zlib';

import {isHostname} from '../banking.utils';

export class MerchantSiteError extends Error {
	constructor(readonly code: 'unsafe_url' | 'unsafe_address' | 'fetch_failed' | 'limit') {
		super(`Merchant site: ${code}`);
		this.name = 'MerchantSiteError';
	}
}

export type MerchantSiteResponse = {bytes: Buffer; url: string};

export type MerchantSiteFetchOptions = {
	accept: string;
	maxBytes: number;
	/** Keep the first `maxBytes` of a longer body instead of failing; enough for a page's `<head>`. */
	truncate?: boolean;
	signal?: AbortSignal;
};

/** Only DNS and the HTTPS transport are replaceable, so tests never weaken URL or address validation. */
export type MerchantSiteNetwork = {
	lookup(hostname: string): Promise<LookupAddress[]>;
	request: typeof request;
};

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; TempoMerchantLogo/1.0)';

/** An https URL on port 443 with a DNS hostname: no credentials, IP literals or other schemes. */
export function toPublicHttpsUrl(input: string, base?: string): URL {
	let url: URL;
	try {
		url = new URL(input, base);
	} catch {
		throw new MerchantSiteError('unsafe_url');
	}
	if (
		/[\u0000-\u0020\u007f\\]/.test(input) ||
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		(url.port && url.port !== '443') ||
		!isHostname(url.hostname)
	)
		throw new MerchantSiteError('unsafe_url');
	url.hash = '';
	return url;
}

/**
 * Fetches a public website resource for a merchant logo: https only, every hop resolved to public unicast addresses
 * and connected to the checked address, bounded in redirects, size and time. Sends no cookies or bank data.
 */
export class MerchantSiteFetcher {
	private readonly network: MerchantSiteNetwork;

	constructor(network?: MerchantSiteNetwork) {
		this.network = network ?? {lookup: (host) => lookup(host, {all: true, verbatim: true}), request};
	}

	async fetch(input: string, options: MerchantSiteFetchOptions): Promise<MerchantSiteResponse> {
		let url = toPublicHttpsUrl(input);
		const controller = new AbortController();
		const abort = () => controller.abort();
		const timer = setTimeout(abort, TIMEOUT_MS);
		options.signal?.addEventListener('abort', abort, {once: true});
		// Settles at the deadline even when a lookup or stream never does: a destroyed response can fail to close.
		const deadline = new Promise<never>((_, reject) =>
			controller.signal.addEventListener('abort', () => reject(new MerchantSiteError('limit')), {once: true}),
		);
		try {
			for (let redirects = 0; ; redirects++) {
				// A hop that loses the race runs on against the aborted signal, which stops any request it still makes.
				const result = await Promise.race([this.hop(url, options, controller.signal), deadline]);
				if (!('redirect' in result)) return result;
				if (redirects >= MAX_REDIRECTS) throw new MerchantSiteError('limit');
				url = toPublicHttpsUrl(result.redirect, url.href);
			}
		} catch (error) {
			if (controller.signal.aborted) throw new MerchantSiteError('limit');
			throw error instanceof MerchantSiteError ? error : new MerchantSiteError('fetch_failed');
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener('abort', abort);
		}
	}

	private async hop(
		url: URL,
		options: MerchantSiteFetchOptions,
		signal: AbortSignal,
	): Promise<MerchantSiteResponse | {redirect: string}> {
		const addresses = await this.network.lookup(url.hostname);
		if (!addresses.length || addresses.some((address) => !isPublicAddress(address)))
			throw new MerchantSiteError('unsafe_address');
		const pinned = addresses[0];
		const response = await new Promise<IncomingMessage>((resolve, reject) => {
			const req = this.network.request(
				{
					hostname: url.hostname,
					servername: url.hostname,
					port: 443,
					path: url.pathname + url.search,
					method: 'GET',
					agent: false,
					rejectUnauthorized: true,
					family: pinned.family,
					maxHeaderSize: 16 * 1024,
					signal,
					headers: {Accept: options.accept, 'Accept-Encoding': 'gzip, deflate, br', 'User-Agent': USER_AGENT},
					// The connection uses the address checked above, never a second DNS answer.
					lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
				},
				resolve,
			);
			req.once('error', reject);
			req.end();
		});
		const status = response.statusCode ?? 0;
		if ([301, 302, 303, 307, 308].includes(status)) {
			response.destroy();
			if (!response.headers.location) throw new MerchantSiteError('fetch_failed');
			return {redirect: response.headers.location};
		}
		if (status !== 200) {
			response.destroy();
			throw new MerchantSiteError('fetch_failed');
		}
		const bytes = await readBody(response, options);
		return {bytes, url: url.href};
	}
}

function isPublicAddress({address, family}: LookupAddress): boolean {
	if (!ipaddr.isValid(address) || address.includes('%')) return false;
	const parsed = ipaddr.parse(address);
	return parsed.range() === 'unicast' && (parsed.kind() === 'ipv4' ? family === 4 : family === 6);
}

/** Decompresses as it reads and counts the decoded bytes, so a small compressed body cannot expand unbounded. */
async function readBody(response: IncomingMessage, {maxBytes, truncate}: MerchantSiteFetchOptions): Promise<Buffer> {
	const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase();
	const decoders: Record<string, (() => Transform) | undefined> = {
		gzip: createGunzip,
		'x-gzip': createGunzip,
		deflate: createInflate,
		br: createBrotliDecompress,
	};
	const decoder = decoders[encoding]?.();
	if (encoding !== 'identity' && !decoder) {
		response.destroy();
		throw new MerchantSiteError('fetch_failed');
	}
	const chunks: Buffer[] = [];
	let size = 0;
	let full = false;
	let markFull = () => {};
	// A truncated read has its bytes once the limit is reached; it does not wait for the streams to tear down.
	const filled = new Promise<void>((resolve) => (markFull = resolve));
	const sink = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			const room = maxBytes - size;
			if (chunk.length > room) {
				if (!truncate) return callback(new MerchantSiteError('limit'));
				chunks.push(chunk.subarray(0, room));
				size = maxBytes;
				full = true;
				markFull();
				return callback(new MerchantSiteError('limit'));
			}
			chunks.push(chunk);
			size += chunk.length;
			callback();
		},
	});
	try {
		await Promise.race([decoder ? pipeline(response, decoder, sink) : pipeline(response, sink), filled]);
	} catch (error) {
		if (!full) throw error instanceof MerchantSiteError ? error : new MerchantSiteError('fetch_failed');
	}
	return Buffer.concat(chunks);
}
